const express = require('express');
const app = express();
require('dotenv').config();
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');

const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Verify Token Middleware
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'unauthorized access' });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qhiqbma.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const apartmentCollection = client.db('windHouse').collection('apartment');
    const usersCollection = client.db('windHouse').collection('users');
    const agreementsCollection = client.db('windHouse').collection('agreements');

    // auth related api
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      });
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      }).send({ success: true });
    });

    app.get('/logout', async (req, res) => {
      try {
        res.clearCookie('token', {
          maxAge: 0,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        }).send({ success: true });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // Get all apartment from db
    app.get('/apartment', async (req, res) => {
      const result = await apartmentCollection.find().toArray();
      res.send(result);
    });

    // Get user info by email from db
    app.get('/user/:email', async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
    
        if (!user) {
          return res.status(404).send({ message: 'User not found' });
        }
    
        const agreement = await agreementsCollection.findOne({ userEmail: email });
    
        res.send({
          ...user,
          agreement: agreement || {
            acceptDate: 'none',
            floorNo: 'none',
            blockName: 'none',
            apartmentNo: 'none',
          },
        });
      } catch (err) {
        res.status(500).send({ message: 'Failed to retrieve user info', error: err.message });
      }
    });
    
    
    // Get all users data from db
    app.get('/users', async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // Save user data in db
    app.put('/user', async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };
      const isExist = await usersCollection.findOne(query);
      if (isExist) {
        if (user.status === 'Requested') {
          const result = await usersCollection.updateOne(query, { $set: { status: user?.status } });
          return res.send(result);
        } else {
          return res.send(isExist);
        }
      }
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // Agreement endpoint
    app.post('/agreement', verifyToken, async (req, res) => {
      const agreement = req.body;
      const existingAgreement = await agreementsCollection.findOne({
        userEmail: agreement.userEmail,
        apartmentNo: agreement.apartmentNo,
      });
      if (existingAgreement) {
        return res.status(400).send({ message: 'You have already applied for this apartment.' });
      }
      const result = await agreementsCollection.insertOne(agreement);
      res.send(result);
    });


    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log('Pinged your deployment. You successfully connected to MongoDB!');
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello from Wind House Server..');
});

app.listen(port, () => {
  console.log(`Wind House is running on port ${port}`);
});
