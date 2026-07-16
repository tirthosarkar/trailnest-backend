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
    // Explore Route (Public)
    app.get('/listing', async (req: Request, res: Response) => {
      try {
        // 1. Extract pagination parameters from query string
        const page = parseInt(req.query.page as string) || 1; // Default: page 1
        const limit = parseInt(req.query.limit as string) || 12; // Default: 12 items per page
        const skip = (page - 1) * limit; // Calculate how many to skip

        // 2. Extract filter parameters (optional)
        const search = (req.query.search as string) || '';
        const type = (req.query.type as string) || '';
        const minPrice = parseFloat(req.query.minPrice as string) || 0;
        const maxPrice = parseFloat(req.query.maxPrice as string) || 999999;
        const sortBy = (req.query.sortBy as string) || 'createdAt';
        const sortOrder = (req.query.sortOrder as string) || 'desc';

        // 3. Build filter object
        const filter: any = {};

        // Price filter
        filter.pricePerDay = {
          $gte: minPrice,
          $lte: maxPrice,
        };

        // Type filter
        if (type) {
          filter.type = type;
        }

        // Search filter (search in name and description)
        if (search) {
          filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
          ];
        }

        // 4. Build sort object
        const sort: any = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        // 5. Get total count for pagination info
        const totalItems = await listingCollection.countDocuments(filter);
        const totalPages = Math.ceil(totalItems / limit);

        // 6. Fetch paginated data
        const result = await listingCollection
          .find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .toArray();

        // 7. Send response with pagination metadata
        res.send({
          data: result,
          pagination: {
            currentPage: page,
            totalPages: totalPages,
            totalItems: totalItems,
            itemsPerPage: limit,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
          },
        });
      } catch (error) {
        console.error('Error fetching listings:', error);
        res.status(500).send({
          error: 'Failed to fetch listings',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
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
