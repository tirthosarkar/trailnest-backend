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
        console.error('Auth Error:', error);
        res.status(500).json({
          message: 'Authentication Failed',
        });
      }
    };

    // ==============================
    // Root API
    // ==============================

    app.get('/', (_req: Request, res: Response) => {
      res.send('TrailNest Backend Running 🚀');
    });

    // ==============================
    // LISTING APIs
    // ==============================

    // Create Listing (Protected)
    app.post(
      '/listing',
      verifyToken,
      async (req: AuthRequest, res: Response) => {
        try {
          const listing = req.body;

          // Validate required fields
          const requiredFields = [
            'name',
            'description',
            'image',
            'type',
            'location',
            'capacity',
            'pricePerDay',
          ];
          for (const field of requiredFields) {
            if (!listing[field]) {
              return res.status(400).send({
                error: `Missing required field: ${field}`,
              });
            }
          }

          const newListing = {
            ...listing,
            ownerId: req.user?._id,
            ownerEmail: req.user?.email,
            bookingCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const result = await listingCollection.insertOne(newListing);

          res.status(201).send({
            success: true,
            data: {
              ...newListing,
              _id: result.insertedId,
            },
          });
        } catch (error) {
          console.error('Error creating listing:', error);
          res.status(500).send({
            error: 'Failed to create listing',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      },
    );

    // Get All Listings (Public) - With Pagination & Filters
    app.get('/listing', async (req: Request, res: Response) => {
      try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 12;
        const skip = (page - 1) * limit;

        const search = (req.query.search as string) || '';
        const type = (req.query.type as string) || '';
        const minPrice = parseFloat(req.query.minPrice as string) || 0;
        const maxPrice = parseFloat(req.query.maxPrice as string) || 999999;
        const sortBy = (req.query.sortBy as string) || 'createdAt';
        const sortOrder = (req.query.sortOrder as string) || 'desc';

        // Build filter
        const filter: any = {};
        filter.pricePerDay = {
          $gte: minPrice,
          $lte: maxPrice,
        };

        if (type) {
          filter.type = type;
        }

        if (search) {
          filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
          ];
        }

        // Build sort
        const sort: any = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        // Get total count
        const totalItems = await listingCollection.countDocuments(filter);
        const totalPages = Math.ceil(totalItems / limit);

        // Fetch paginated data
        const result = await listingCollection
          .find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .toArray();

        // Get booking counts for each listing
        const listingsWithStats = await Promise.all(
          result.map(async listing => {
            const bookingCount = await bookingCollection.countDocuments({
              listingId: listing._id,
            });
            return {
              ...listing,
              bookingCount,
            };
          }),
        );

        res.send({
          data: listingsWithStats,
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

    // Get Featured Listings (Public)
    app.get('/featured', async (_req: Request, res: Response) => {
      try {
        const result = await listingCollection
          .find()
          .sort({ createdAt: -1 })
          .limit(6)
          .toArray();

        const featuredWithStats = await Promise.all(
          result.map(async listing => {
            const bookingCount = await bookingCollection.countDocuments({
              listingId: listing._id,
            });
            return {
              ...listing,
              bookingCount,
            };
          }),
        );

        res.send(featuredWithStats);
      } catch (error) {
        console.error('Error fetching featured listings:', error);
        res.status(500).send({
          error: 'Failed to fetch featured listings',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Get Single Listing (Public)
    app.get('/listing/:id', async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const idString = Array.isArray(id) ? id[0] : id;

        if (!ObjectId.isValid(idString)) {
          return res.status(400).send({
            error: 'Invalid listing ID format',
          });
        }

        const result = await listingCollection.findOne({
          _id: new ObjectId(idString),
        });

        if (!result) {
          return res.status(404).send({
            error: 'Listing not found',
          });
        }

        // Get booking count
        const bookingCount = await bookingCollection.countDocuments({
          listingId: result._id,
        });

        res.send({
          ...result,
          bookingCount,
        });
      } catch (error) {
        console.error('Error fetching listing:', error);
        res.status(500).send({
          error: 'Failed to fetch listing',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Update Listing (Protected - Owner Only)
    app.put(
      '/listing/:id',
      verifyToken,
      async (req: AuthRequest, res: Response) => {
        try {
          const { id } = req.params;
          const idString = Array.isArray(id) ? id[0] : id;

          if (!ObjectId.isValid(idString)) {
            return res.status(400).send({
              error: 'Invalid listing ID format',
            });
          }

          const listing = await listingCollection.findOne({
            _id: new ObjectId(idString),
          });

          if (!listing) {
            return res.status(404).send({
              message: 'Listing not found',
            });
          }

          if (listing.ownerEmail !== req.user?.email) {
            return res.status(403).send({
              message: "Forbidden - You don't own this listing",
            });
          }

          const updates = req.body;
          delete updates._id;
          delete updates.ownerId;
          delete updates.ownerEmail;
          delete updates.createdAt;

          await listingCollection.updateOne(
            {
              _id: new ObjectId(idString),
            },
            {
              $set: {
                ...updates,
                updatedAt: new Date(),
              },
            },
          );

          const updatedListing = await listingCollection.findOne({
            _id: new ObjectId(idString),
          });

          res.send({
            success: true,
            data: updatedListing,
          });
        } catch (error) {
          console.error('Error updating listing:', error);
          res.status(500).send({
            error: 'Failed to update listing',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      },
    );

    // Delete Listing (Protected - Owner Only)
    app.delete(
      '/listing/:id',
      verifyToken,
      async (req: AuthRequest, res: Response) => {
        try {
          const { id } = req.params;
          const idString = Array.isArray(id) ? id[0] : id;

          if (!ObjectId.isValid(idString)) {
            return res.status(400).send({
              error: 'Invalid listing ID format',
            });
          }

          const listing = await listingCollection.findOne({
            _id: new ObjectId(idString),
          });

          if (!listing) {
            return res.status(404).send({
              message: 'Listing not found',
            });
          }

          if (listing.ownerEmail !== req.user?.email) {
            return res.status(403).send({
              message: "Forbidden - You don't own this listing",
            });
          }

          await listingCollection.deleteOne({
            _id: new ObjectId(idString),
          });

          // Also delete related bookings
          await bookingCollection.deleteMany({
            listingId: new ObjectId(idString),
          });

          res.send({
            success: true,
            message: 'Listing deleted successfully',
          });
        } catch (error) {
          console.error('Error deleting listing:', error);
          res.status(500).send({
            error: 'Failed to delete listing',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      },
    );

    // Get My Listings (Protected)
    app.get(
      '/my-listings',
      verifyToken,
      async (req: AuthRequest, res: Response) => {
        try {
          const result = await listingCollection
            .find({
              ownerEmail: req.user?.email,
            })
            .sort({
              createdAt: -1,
            })
            .toArray();

          res.send(result);
        } catch (error) {
          console.error('Error fetching my listings:', error);
          res.status(500).send({
            error: 'Failed to fetch your listings',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      },
    );

    // ==============================
    // BOOKING APIs
    // ==============================

    // Get user's bookings (already exists from previous step)
    app.get(
      '/my-bookings',
      verifyToken,
      async (req: AuthRequest, res: Response) => {
        try {
          const bookings = await bookingCollection
            .find({
              userEmail: req.user?.email,
            })
            .sort({
              createdAt: -1,
            })
            .toArray();

          // Get listing details for each booking
          const bookingsWithDetails = await Promise.all(
            bookings.map(async booking => {
              const listing = await listingCollection.findOne({
                _id: booking.listingId,
              });
              return {
                ...booking,
                listing: listing || null,
              };
            }),
          );

          res.send(bookingsWithDetails);
        } catch (error) {
          console.error('Error fetching bookings:', error);
          res.status(500).send({
            error: 'Failed to fetch bookings',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      },
    );

    // Create Booking (Protected)
    // Create Booking (Protected) - With conflict check

    app.post(
      '/bookings',
      verifyToken,
      async (req: AuthRequest, res: Response) => {
        try {
          const {
            listingId,
            listingType,
            startDate,
            endDate,
            guests,
            quantity,
            totalPrice,
            specialNote,
          } = req.body;

          console.log('📦 Booking request:', {
            listingId,
            listingType,
            startDate,
            endDate,
            guests,
            quantity,
            totalPrice,
          });

          // Validate required fields
          if (!listingId || !listingType || !totalPrice) {
            return res.status(400).send({
              error: 'Missing required booking fields',
            });
          }

          const idString = Array.isArray(listingId) ? listingId[0] : listingId;

          if (!ObjectId.isValid(idString)) {
            return res.status(400).send({
              error: 'Invalid listing ID format',
            });
          }

          // Check if listing exists
          const listing = await listingCollection.findOne({
            _id: new ObjectId(idString),
          });

          if (!listing) {
            return res.status(404).send({
              error: 'Listing not found',
            });
          }

          // For campsites: validate dates and check conflicts
          if (listingType === 'campsite') {
            if (!startDate || !endDate) {
              return res.status(400).send({
                error: 'Start date and end date are required for campsites',
              });
            }

            const start = new Date(startDate);
            const end = new Date(endDate);

            // Validate dates
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (start < today) {
              return res.status(400).send({
                error: 'Start date must be today or a future date',
              });
            }

            if (end <= start) {
              return res.status(400).send({
                error: 'End date must be after start date',
              });
            }

            // Check for overlapping bookings
            const overlappingBookings = await bookingCollection.findOne({
              listingId: new ObjectId(idString),
              status: 'confirmed',
              $or: [
                {
                  startDate: { $gte: start, $lt: end },
                },
                {
                  endDate: { $gt: start, $lte: end },
                },
                {
                  startDate: { $lte: start },
                  endDate: { $gte: end },
                },
              ],
            });

            if (overlappingBookings) {
              return res.status(409).send({
                error: 'Date conflict',
                message:
                  'These dates are already booked. Please select different dates.',
              });
            }
          }

          // Create booking object
          const booking: any = {
            listingId: new ObjectId(idString),
            listingType,
            userId: req.user?._id,
            userName: req.user?.name,
            userEmail: req.user?.email,
            totalPrice,
            specialNote: specialNote || null,
            status: 'confirmed',
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          // Add type-specific fields
          if (listingType === 'campsite') {
            booking.startDate = new Date(startDate);
            booking.endDate = new Date(endDate);
            booking.guests = guests || 1;
          } else {
            booking.quantity = quantity || 1;
          }

          console.log('📝 Creating booking:', booking);

          const result = await bookingCollection.insertOne(booking);

          // Increment booking count
          await listingCollection.updateOne(
            { _id: new ObjectId(idString) },
            {
              $inc: { bookingCount: 1 },
              $set: { updatedAt: new Date() },
            },
          );

          res.status(201).send({
            success: true,
            data: {
              ...booking,
              _id: result.insertedId,
            },
          });
        } catch (error) {
          console.error('Error creating booking:', error);
          res.status(500).send({
            error: 'Failed to create booking',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      },
    );
    // Get My Bookings (Protected)
    // Get bookings for a listing (for conflict check)
    app.get(
      '/bookings/listing/:listingId',
      async (req: Request, res: Response) => {
        try {
          const { listingId } = req.params;
          const idString = Array.isArray(listingId) ? listingId[0] : listingId;

          if (!ObjectId.isValid(idString)) {
            return res.status(400).send({
              error: 'Invalid listing ID format',
            });
          }

          const bookings = await bookingCollection
            .find({
              listingId: new ObjectId(idString),
              status: 'confirmed',
            })
            .project({
              startDate: 1,
              endDate: 1,
              status: 1,
            })
            .toArray();

          res.send(bookings);
        } catch (error) {
          console.error('Error fetching bookings:', error);
          res.status(500).send({
            error: 'Failed to fetch bookings',
          });
        }
      },
    );

    // Cancel Booking (Protected)
    app.delete(
      '/bookings/:id',
      verifyToken,
      async (req: AuthRequest, res: Response) => {
        try {
          const { id } = req.params;
          const idString = Array.isArray(id) ? id[0] : id;

          if (!ObjectId.isValid(idString)) {
            return res.status(400).send({
              error: 'Invalid booking ID format',
            });
          }

          const booking = await bookingCollection.findOne({
            _id: new ObjectId(idString),
          });

          if (!booking) {
            return res.status(404).send({
              message: 'Booking not found',
            });
          }

          // Check if user owns this booking
          if (booking.userEmail !== req.user?.email) {
            return res.status(403).send({
              message: "Forbidden - You don't own this booking",
            });
          }

          // Update booking status
          await bookingCollection.updateOne(
            { _id: new ObjectId(idString) },
            {
              $set: {
                status: 'cancelled',
                updatedAt: new Date(),
              },
            },
          );

          // Decrement booking count
          await listingCollection.updateOne(
            { _id: booking.listingId },
            { $inc: { bookingCount: -1 } },
          );

          res.send({
            success: true,
            message: 'Booking cancelled successfully',
          });
        } catch (error) {
          console.error('Error cancelling booking:', error);
          res.status(500).send({
            error: 'Failed to cancel booking',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      },
    );

    // ==============================
    // Protected User API
    // ==============================

    app.get('/me', verifyToken, async (req: AuthRequest, res: Response) => {
      res.send(req.user);
    });

    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`🚀 Server Running on Port ${port}`);
});
