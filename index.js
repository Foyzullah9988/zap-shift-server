const express = require('express')
const app = express()
const cors = require('cors')
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000;
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto = require("crypto");
const { accessSync, stat } = require('fs');

// firebase json sdk
const admin = require("firebase-admin");
const serviceAccount = require("./fbsdk.json");
const { CLIENT_RENEG_WINDOW } = require('tls');
const { cursorTo } = require('readline');
const { resolveMx } = require('dns');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


function generateTrackingId() {
    const prefix = "PRCL"; // your brand prefix

    // Date → YYYYMMDD
    const date = new Date()
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "");

    // 6-char random HEX
    const random = crypto.randomBytes(3).toString("hex").toUpperCase();

    // Final tracking ID
    return `${prefix}-${date}-${random}`;
}


// middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
    // console.log(req.headers.authorization);
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ message: 'unauthorize access' })
    }
    try {
        const idToken = token.split(' ')[1];
        // console.log(idToken);
        const decoded = await admin.auth().verifyIdToken(idToken);
        req.decoded_email = decoded.email;
        // console.log(decoded);
        next()
    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorize access' })
    }
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.r5czbuf.mongodb.net/?appName=Cluster0`;



// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


app.get('/', (req, res) => {
    res.send('Zap is shifting')
})

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        
        const db = client.db('zap_shift_db')
        const parcelCollection = db.collection('parcels');
        const paymentCollection = db.collection('payment');
        const userCollection = db.collection('users');
        const ridersCollection = db.collection('riders');




        // middleware for admin allowing admin activity
        // must be used after verifyFBToken middleware
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await userCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }

            next();
        }






        // riders related api's
        app.post('/riders', async (req, res) => {
            const rider = req.body;
            rider.status = 'pending';
            rider.createdAt = new Date();

            const result = await ridersCollection.insertOne(rider);
            res.send(result)
        })

        app.patch('/riders/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const status = req.body.status;
            const query = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: status,
                    workStatus: 'available'
                }
            }

            if (status === 'approved') {
                const email = req.body.email;
                const userQuery = { email };
                const updateUser = {
                    $set: {
                        role: 'rider',

                    }
                }
                const userResult = await userCollection.updateOne(userQuery, updateUser)
                // res.send(userResult)
            }
            // else if(status === 'rejected'){
            //     const email = req.body.email;
            //     const userQuery = {email};
            //     const updateUser = {
            //         $set:{
            //             role:'user'
            //         }
            //     }
            //     const userResult = await userCollection.updateOne(userQuery,updateUser)

            // }

            const result = await ridersCollection.updateOne(query, updateDoc);
            res.send(result)
        })

        // app.get('/riders/:id',async(req,res)=>{
        //     const id = req.params.id;
        //     const query = {_id:new ObjectId(id)};
        //     const result = await ridersCollection.findOne(query);
        //     res.send(result)

        // })

        // parcel related api
        app.get('/riders', async (req, res) => {
            const { status, district, workStatus } = req.query;

            const query = {};
            if (req.query.status) {
                query.status = req.query.status
            }
            if (status) {
                query.status = status
            }
            if (district) {
                query.district = district
            }
            if (workStatus) {
                query.workStatus = workStatus
            }
            // console.log(query);
            const cursor = ridersCollection.find(query)

            const result = await cursor.toArray();
            res.send(result)
        })








        // users Related api's
        app.get('/users', verifyFBToken, async (req, res) => {
            const cursor = userCollection.find();
            const result = await cursor.toArray();
            res.send(result)
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user';
            user.createdAt = new Date();
            const email = user.email;
            const userExist = await userCollection.findOne({ email });

            if (userExist) {
                return res.send({ message: 'user exists' })
            }

            const result = await userCollection.insertOne(user);
            res.send(result)
        })

        app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const roleInfo = req.body;
            const query = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await userCollection.updateOne(query, updateDoc);
            res.send(result)
        })

        // app.get('/users/:id', async (req, res) => {

        // })

        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email });
            res.send({ role: user?.role || 'user' })
        })






        // parcel related api

        app.get('/parcels', async (req, res) => {
            const query = {}
            const { email, deliveryStatus } = req.query;

            if (email) {
                query.senderEmail = email
            }
            if (deliveryStatus) {
                query.deliveryStatus = deliveryStatus
            }

            const options = { sort: { createdAt: -1 } }

            const cursor = parcelCollection.find(query, options);
            const result = await cursor.toArray();
            res.send(result)
        })

        app.post('/parcels', async (req, res) => {
            const parcel = req.body;
            // parcel created time 
            parcel.createdAt = new Date()
            const result = await parcelCollection.insertOne(parcel)
            res.send(result)
        })

        app.get('/parcels/rider', async (req, res) => {
            const { riderEmail, deliveryStatus } = req.query;
            const query = {};

            if (riderEmail) {
                query.riderEmail = riderEmail
            }
            if (deliveryStatus) {
                // query.deliveryStatus = {$in:['rider_assigned','rider_arriving']}
                query.deliveryStatus = {$nin:['parcel_delivered']}
            }

            const cursor = parcelCollection.find(query)
            const result = await cursor.toArray();
            res.send(result)
        })

        app.get('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            // const query = 
            const result = await parcelCollection.findOne({ _id: new ObjectId(id) })
            res.send(result)
        })

        app.patch('/parcels/:id', async (req, res) => {
            const { riderId, riderName, riderEmail } = req.body;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const updateParcel = {
                $set: {
                    deliveryStatus: 'rider_assigned',
                    riderId: riderId,
                    riderName: riderName,
                    riderEmail: riderEmail,
                }
            }

            const parcelResult = await parcelCollection.updateOne(query, updateParcel)

            // update rider info
            const riderQuery = { _id: new ObjectId(riderId) }
            const updateRider = {
                $set: {
                    workStatus: 'in_delivery'
                }
            }

            const riderResult = await ridersCollection.updateOne(riderQuery, updateRider)
            res.send(riderResult)
        })

        app.patch('/parcels/:id/status',async(req,res)=>{
            const {deliveryStatus}=req.body;
            const query={_id:new ObjectId(req.params.id)};
            const updateDoc={
                $set:{
                    deliveryStatus:deliveryStatus
                }
            }
            const result = await parcelCollection.updateOne(query,updateDoc)
            res.send(result)
        })

        app.delete('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await parcelCollection.deleteOne(query)
            res.send(result)
        })








        // payment related api's
        app.post('/create-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.cost) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: "USD",
                            unit_amount: amount,
                            product_data: {
                                name: `Please pay for '${paymentInfo.parcelName}'`
                            }
                        },
                        quantity: 1,
                    },
                ],
                customer_email: paymentInfo.senderEmail,
                mode: 'payment',
                metadata: {
                    parcelId: paymentInfo.parcelId,
                    parcelName: paymentInfo.parcelName,
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
            });
            // console.log(paymentInfo.parcelId);
            // console.log(session);
            res.send({ url: session.url })
        })

        app.patch('/payment-success', async (req, res) => {
            const session = client.startSession();

            try {
                await session.withTransaction(async () => {
                    const sessionId = req.query.session_id;
                    const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
                    const transactionId = stripeSession.payment_intent;

                    if (stripeSession.payment_status !== 'paid') {
                        await session.abortTransaction();
                        return res.send({ success: false });
                    }

                    const paymentExist = await paymentCollection.findOne({ transactionId }, { session });
                    if (paymentExist) {
                        await session.abortTransaction();
                        return res.send({
                            message: 'already exist',
                            transactionId,
                            trackingId: paymentExist.trackingId
                        });
                    }

                    const trackingId = generateTrackingId();
                    const id = stripeSession.metadata.parcelId;
                    const query = { _id: new ObjectId(id) };

                    const update = {
                        $set: {
                            paymentStatus: 'paid',
                            deliveryStatus: 'pending-pickup',
                            trackingId: trackingId
                        }
                    };
                    const result = await parcelCollection.updateOne(query, update, { session });

                    const payment = {
                        amount: stripeSession.amount_total / 100,
                        currency: stripeSession.currency,
                        customerEmail: stripeSession.customer_email,
                        parcelID: stripeSession.metadata.parcelId,
                        parcelName: stripeSession.metadata.parcelName,
                        transactionId: stripeSession.payment_intent,
                        paymentStatus: stripeSession.payment_status,
                        paidAt: new Date(),
                        trackingId
                    };

                    const resultPayment = await paymentCollection.insertOne(payment, { session });

                    res.send({
                        success: true,
                        modifyParcel: result,
                        transactionId,
                        trackingId,
                        paymentInfo: resultPayment
                    });
                });
            } catch (error) {
                console.error('Payment processing error:', error);

                if (error.code === 11000) {
                    const sessionId = req.query.session_id;
                    const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
                    const transactionId = stripeSession.payment_intent;

                    const existingPayment = await paymentCollection.findOne({ transactionId });
                    res.send({
                        message: 'already exist',
                        transactionId,
                        trackingId: existingPayment.trackingId
                    });
                } else {
                    res.status(500).send({
                        success: false,
                        error: 'Payment processing failed',
                        message: error.message
                    });
                }
            } finally {
                await session.endSession();
            }
        });

        // show payment api's in ui
        app.get('/payments', verifyFBToken, async (req, res) => {
            const email = req.query.email;
            const query = {};
            // console.log(req.headers);

            if (email) {
                query.customerEmail = email
                if (email !== req.decoded_email) {
                    return res.status(403).send({ message: 'forbidden access' })
                }
            }

            const cursor = paymentCollection.find(query).sort({ paidAt: -1 })
            const result = await cursor.toArray();

            res.send(result)
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})