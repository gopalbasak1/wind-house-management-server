const express = require('express');
const app = express();
require('dotenv').config();
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const stripe = require("stripe")(process.env.STRIP_SECRET_KEY)


const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
  origin: [
    'http://localhost:5173', 
    'http://localhost:5174',
    'https://windhouse-92e50.web.app/',
   ' https://windhouse-92e50.firebaseapp.com/'
  ],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Verify Token Middleware
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1];
  if (!token) {
    return res.status(401).send({ message: 'Unauthorized access' });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'Unauthorized access' });
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
    const acceptedAgreementsCollection = client.db('windHouse').collection('acceptedAgreements'); // New collection
    const paymentsCollection = client.db('windHouse').collection('payments');
    const couponsCollection = client.db('windHouse').collection('coupons');
    const announcementsCollection = client.db('windHouse').collection('announcements');

     // Verify Admin Middleware
     const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== 'admin') {
        return res.status(401).send({ message: 'Unauthorized access' });
      }
      next();
    };
    


     //verify host middleware
     const verifyMember = async(req, res, next)=>{
      console.log('hello');
      const user = req.user;
      const query = {email: user?.email};
      const result = await usersCollection.findOne(query);
      if(!result || result?.role !== 'member'){
        return res.status(401).send({message: 'unauthorized access!!'})
      }

        next();
    }

    // auth related api
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({ token });
    })

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
    app.post('/agreement', async (req, res) => {
      const agreement = req.body;
      const existingAgreement = await agreementsCollection.findOne({
        userEmail: agreement.userEmail,
        apartmentNo: agreement.apartmentNo,
      });

      if (existingAgreement) {
        return res.status(400).send({ message: 'You have already applied for this apartment.' });
      }

      // Add a timestamp to the agreement data
      agreement.timestamp = new Date();

      const result = await agreementsCollection.insertOne(agreement);
      res.send(result);
    });

    // Get all agreement requests
    app.get('/agreements', async (req, res) => {
      try {
        const agreements = await agreementsCollection.find({ status: 'pending' }).toArray();
        res.send(agreements);
      } catch (err) {
        res.status(500).send({ message: 'Failed to retrieve agreement requests', error: err.message });
      }
    });

  // Update agreement status
app.put('/agreement/status', verifyToken, async (req, res) => {
  const { id, status, userEmail } = req.body;

  if (!id || !status) {
    return res.status(400).send({ message: 'ID and status are required' });
  }

  try {
    const query = { _id: new ObjectId(id) };
    const updateDoc = { $set: { status } };
    const result = await agreementsCollection.updateOne(query, updateDoc);

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: 'Agreement not found' });
    }

    // If the agreement is accepted, update the user's role to 'member' and agreement details
    if (status === 'accepted') {
      const agreement = await agreementsCollection.findOne(query);

      // Store the accepted agreement in the new collection
      const acceptedAgreement = {
        ...agreement,
        acceptDate: new Date(),
        status: 'accepted',
      };
      await acceptedAgreementsCollection.insertOne(acceptedAgreement);

      await usersCollection.updateOne(
        { email: userEmail },
        {
          $set: {
            role: 'member',
            agreement: {
              acceptDate: acceptedAgreement.acceptDate,
              floorNo: acceptedAgreement.floorNo,
              blockName: acceptedAgreement.blockName,
              apartmentNo: acceptedAgreement.apartmentNo,
              rent: acceptedAgreement.rent,
              status: acceptedAgreement.status,
              timestamp: acceptedAgreement.timestamp,
            },
          },
        }
      );
    }

    res.send({ success: true, message: 'Agreement status updated successfully' });
  } catch (err) {
    res.status(500).send({ message: 'Failed to update agreement status', error: err.message });
  }
});


    // Endpoint to validate coupon
    app.post('/validate-coupon', async (req, res) => {
      const { couponCode } = req.body;
      const coupon = await couponsCollection.findOne({ code: couponCode });

      if (!coupon || coupon.expired) {
        return res.status(400).send({ message: 'Invalid or expired coupon' });
      }

      res.send({ discount: coupon.discount });
    });

    // Endpoint to record payment
    app.post('/make-payment', async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      res.send(result);
    });

    app.put('/user/accept-request', verifyToken, async (req, res) => {
      const { email, agreementDetails } = req.body;
    
      if (!email || !agreementDetails) {
        return res.status(400).send({ message: 'Email and agreement details are required' });
      }
    
      try {
        const result = await usersCollection.updateOne(
          { email },
          { $set: { agreement: agreementDetails } }
        );
    
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: 'User not found' });
        }
    
        res.send({ success: true, message: 'Agreement accepted and updated successfully' });
      } catch (err) {
        res.status(500).send({ message: 'Failed to update user agreement', error: err.message });
      }
    });
    

    // Update user role and agreement data
    // Update user role and agreement data
app.put('/user/role', verifyToken, async (req, res) => {
  const { email, role, agreementDetails } = req.body;

  try {
    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    const updateDoc = {
      $set: {
        role,
        agreement: agreementDetails,
      },
    };

    const result = await usersCollection.updateOne({ email }, updateDoc);
    res.send(result);
  } catch (err) {
    res.status(500).send({ message: 'Failed to update user role', error: err.message });
  }
});

    // Get user's profile data
   // Get user's profile data
app.get('/profile', verifyToken, async (req, res) => {
  try {
    const email = req.user.email;
    const user = await usersCollection.findOne({ email });
    console.log(user);
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    const profile = {
      name: user.name,
      image: user.image,
      email: user.email,
      agreement: user.agreement || 
      {
        acceptDate: 'none',
        floorNo: 'none',
        blockName: 'none',
        apartmentNo: 'none',
        rent: 'none',
        status: 'none',
        timestamp: 'none',
      },
    };

    res.send(profile);
  } catch (err) {
    res.status(500).send({ message: 'Failed to retrieve profile data', error: err.message });
  }
});


    // Get all payments made by a user
    app.get('/payments/:userEmail', async (req, res) => {
      const { userEmail } = req.params;
      const payments = await paymentsCollection.find({ userEmail }).toArray();
      res.send(payments);
    });

    // Get payment by id
    app.get('/payment/:id', async (req, res) => {
      const { id } = req.params;
      const payment = await paymentsCollection.findOne({ _id: new ObjectId(id) });
      res.send(payment);
    });

    app.post('/store-payment', verifyToken, async (req, res) => {
      const payment = req.body;
      try {
        const result = await paymentsCollection.insertOne(payment);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to store payment', error: err.message });
      }
    });

    app.get('/payments/:userEmail', async (req, res) => {
      const { userEmail } = req.params;
      const payments = await paymentsCollection.find({ userEmail }).toArray();
      res.send(payments);
    });

    app.get('/payments', verifyToken, verifyAdmin, async (req, res)=>{
      const result = await paymentsCollection.find().toArray();
      res.send(result)
    })
    


    // Add or update a coupon
app.put('/coupon', async (req, res) => {
  const coupon = req.body;
  const query = { code: coupon.code };
  const updateDoc = { $set: coupon };
  const options = { upsert: true };
  const result = await couponsCollection.updateOne(query, updateDoc, options);
  res.send(result);
});

// Get all coupons
app.get('/coupons', async (req, res) => {
  const coupons = await couponsCollection.find().toArray();
  res.send(coupons);
});

// Delete a coupon
app.delete('/coupon/:id', async (req, res) => {
  const { id } = req.params;
  const query = { _id: new ObjectId(id) };
  const result = await couponsCollection.deleteOne(query);
  res.send(result);
});



 // Update user info endpoint
app.put('/user/:id', async (req, res) => {
  const id = req.params.id;
  const user = req.body;
  console.log("Updating user with ID:", id); // Debug log
  console.log("New user data:", user); // Debug log

  const query = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: user,
  };

  try {
    const result = await usersCollection.updateOne(query, updateDoc);
    if (result.matchedCount === 0) {
      return res.status(404).send({ message: 'User not found' });
    }
    res.send(result);
  } catch (err) {
    console.error("Error updating user:", err); // Error log
    res.status(500).send({ message: 'Failed to update user', error: err.message });
  }
});



    // Add this endpoint in your Express server setup
    app.get('/accepted-agreements/:userEmail', verifyToken, async (req, res) => {
      const { userEmail } = req.params;
      try {
        const acceptedAgreements = await acceptedAgreementsCollection.find({ userEmail }).toArray();
        res.send(acceptedAgreements);
      } catch (err) {
        res.status(500).send({ message: 'Failed to retrieve accepted agreements', error: err.message });
      }
    });

    //create-payment-intent
    app.post('/create-payment-intent', verifyToken, async(req, res)=>{
      const price = req.body.price;
      const priceInCent = parseFloat(price)*100;
      if(!price || priceInCent < 1) return;
      //generate clientSecret
      const {client_secret} = await stripe.paymentIntents.create({
        amount: priceInCent,
        currency: "usd",
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
        automatic_payment_methods: {
          enabled: true,
        },
      })
      //send client secret as response
      res.send({clientSecret: client_secret})

    });

    // Add this to check the server is receiving the request correctly
  // Add this to check the server is receiving the request correctly
  app.post('/announcements', async (req, res) => {
    const reviewData = req.body;
      const result = await announcementsCollection.insertOne(reviewData);
      res.send(result);
  });
  
  app.get('/announcements', async (req, res) => {
    const result = await announcementsCollection.find().toArray();
      res.send(result);
  });

  app.get('/admin-profile', verifyToken, verifyAdmin, async (req, res) => {
    try {
      const userEmail = req.user.email;
      const user = await usersCollection.findOne({ email: userEmail });
  
      if (!user) {
        return res.status(404).send({ message: 'Admin not found' });
      }
  
      const totalRooms = await apartmentCollection.countDocuments();
      const totalUsers = await usersCollection.countDocuments();
      const totalMembers = await usersCollection.countDocuments({ role: 'member' });
      const totalAgreements = await agreementsCollection.countDocuments();
      const unavailableRooms = await agreementsCollection.countDocuments({ status: 'accepted' });
  
      const availableRooms = totalRooms - unavailableRooms;
      const percentageAvailableRooms = (availableRooms / totalRooms) * 100;
      const percentageUnavailableRooms = (unavailableRooms / totalRooms) * 100;
  
      const adminProfile = {
        name: user.displayName,
        image: user.image,
        email: user.email,
        totalRooms,
        percentageAvailableRooms: percentageAvailableRooms.toFixed(2),
        percentageUnavailableRooms: percentageUnavailableRooms.toFixed(2),
        totalUsers,
        totalMembers,
      };
  
      res.send(adminProfile);
    } catch (err) {
      res.status(500).send({ message: 'Failed to retrieve admin profile', error: err.message });
    }
  });
  
  

   // Get apartments with pagination
// Get apartments with pagination
app.get('/apartment', async (req, res) => {
  const page = parseInt(req.query.page) || 1; // Default to page 1 if not provided
  const limit = parseInt(req.query.limit) || 6; // Default to 6 items per page if not provided
  const skip = (page - 1) * limit;

  try {
      const apartments = await apartmentCollection.find().skip(skip).limit(limit).toArray();
      const total = await apartmentCollection.countDocuments();
      res.send({ apartments, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
      res.status(500).send({ error: 'An error occurred while fetching apartments' });
  }
});



    // await client.db('admin').command({ ping: 1 });
    // console.log('Pinged your deployment. You successfully connected to MongoDB!');
  } finally {
    // Do not close the connection as the server should keep running
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('WindHouse server is running');
});

app.listen(port, () => {
  console.log(`WindHouse server is running on port ${port}`);
});