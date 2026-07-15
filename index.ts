import express, { NextFunction, Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { MongoClient, ObjectId, ServerApiVersion } from 'mongodb';

dotenv.config();

const app = express();

const port = Number(process.env.PORT) || 5000;

const uri = process.env.MONGO_DB_URI;
const DB = process.env.AUTH_DB_NAME;

if (!uri) {
  throw new Error('MONGO_DB_URI is missing.');
}

if (!DB) {
  throw new Error('AUTH_DB_NAME is missing.');
}

app.use(cors());
app.use(express.json());

// MongoDB Client
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Request type
interface AuthRequest extends Request {
  user?: {
    _id: ObjectId;
    name?: string;
    email?: string;
    image?: string;
    role?: string;
    status?: string;
  };
}

async function run() {
  try {
    // await client.connect();

    const db = client.db(DB);

    const userCollection = db.collection('user');
    const sessionCollection = db.collection('session');
    const listingCollection = db.collection('listings');
    const bookingCollection = db.collection('bookings');

    // ==============================
    // BetterAuth Verify Token
    // ==============================

    const verifyToken = async (
      req: AuthRequest,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
          return res.status(401).json({
            message: 'Authentication Required',
          });
        }

        const token = authHeader.split(' ')[1];

        if (!token) {
          return res.status(401).json({
            message: 'Invalid Token',
          });
        }

        const session = await sessionCollection.findOne({
          token,
        });

        if (!session) {
          return res.status(401).json({
            message: 'Session Expired',
          });
        }

        const user = await userCollection.findOne({
          _id: session.userId,
        });

        if (!user) {
          return res.status(401).json({
            message: 'User Not Found',
          });
        }

        req.user = user as AuthRequest['user'];

        next();
      } catch (error) {
        console.log(error);

        res.status(500).json({
          message: 'Authentication Failed',
        });
      }
    };

    interface Listing {
      title: string;
      description: string;
      image: string;
      location: string;
      price: number;
      duration: string;
      maxGuests: number;
    }

    // ==============================
    // Root API
    // ==============================

    app.get('/', (_req: Request, res: Response) => {
      res.send('TrailNest Backend Running 🚀');
    });

    //! Listing APIs
    // ==============================
    app.post(
      '/listing',
      verifyToken,
      async (req: AuthRequest, res: Response) => {
        const listing: Listing = req.body;

        const newListing = {
          ...listing,
          ownerId: req.user?._id,
          ownerEmail: req.user?.email,
          bookingCount: 0,
          createdAt: new Date(),
        };

        const result = await listingCollection.insertOne(newListing);

        res.send(result);
      },
    );

    app.get('/listing', async (_req: Request, res: Response) => {
      const result = await listingCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    app.get('/featured', async (_req: Request, res: Response) => {
      const result = await listingCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();

      res.send(result);
    });

    app.get('/listing/:id', async (req: Request, res: Response) => {
      const { id } = req.params;

      const result = await listingCollection.findOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    app.put(
      '/listing/:id',
      verifyToken,
      async (req: AuthRequest, res: Response) => {
        const { id } = req.params;

        const listing = await listingCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!listing) {
          return res.status(404).send({
            message: 'Listing not found',
          });
        }

        if (listing.ownerEmail !== req.user?.email) {
          return res.status(403).send({
            message: 'Forbidden',
          });
        }

        await listingCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $set: {
              ...req.body,
              updatedAt: new Date(),
            },
          },
        );

        res.send({
          message: 'Updated Successfully',
        });
      },
    );

    app.delete(
      '/listing/:id',
      verifyToken,
      async (req: AuthRequest, res: Response) => {
        const { id } = req.params;

        const listing = await listingCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!listing) {
          return res.status(404).send({
            message: 'Listing not found',
          });
        }

        if (listing.ownerEmail !== req.user?.email) {
          return res.status(403).send({
            message: 'Forbidden',
          });
        }

        await listingCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send({
          message: 'Deleted Successfully',
        });
      },
    );

    app.get(
      '/my-listings',
      verifyToken,
      async (req: AuthRequest, res: Response) => {
        const result = await listingCollection
          .find({
            ownerEmail: req.user?.email,
          })
          .sort({
            createdAt: -1,
          })
          .toArray();

        res.send(result);
      },
    );

    // ==============================
    // Protected API
    // ==============================

    app.get('/me', verifyToken, async (req: AuthRequest, res: Response) => {
      res.send(req.user);
    });

    console.log('✅ MongoDB Connected');
  } finally {
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`🚀 Server Running on Port ${port}`);
});
