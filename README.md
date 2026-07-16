<div align="center">

<h1>
  <span style="color:#155e75">Trail</span><span style="color:#0d9488">Nest</span> — Backend API
</h1>

<p>Express + TypeScript API powering the TrailNest outdoor gear & campsite booking platform.</p>

<p>
  <a href="https://trailnest-backend-alpha.vercel.app/"><img src="https://img.shields.io/badge/Live%20API-visit-155e75?style=for-the-badge" alt="Live API" /></a>
  <a href="https://trailnest-client.vercel.app/"><img src="https://img.shields.io/badge/Live%20Site-visit-0d9488?style=for-the-badge" alt="Live Site" /></a>
  <a href="https://github.com/tirthosarkar/trailnest-client.git"><img src="https://img.shields.io/badge/Frontend-repo-181717?style=for-the-badge&logo=github" alt="Frontend Repo" /></a>
</p>

<p>
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-5-black?style=flat-square&logo=express" alt="Express" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/MongoDB-native%20driver-47A248?style=flat-square&logo=mongodb&logoColor=white" alt="MongoDB" />
</p>

</div>

<br />

## About

This is the API server for **TrailNest**, a full-stack outdoor gear and campsite booking platform. It handles listing CRUD, paginated search/filtering, date-conflict-checked bookings, and session verification against [BetterAuth](https://www.better-auth.com/)'s own MongoDB collections — no separate auth system to keep in sync with the frontend.

It's a single-file Express server written in TypeScript, deployed as a serverless function on Vercel.

**🔗 Live API:** [trailnest-backend-alpha.vercel.app](https://trailnest-backend-alpha.vercel.app/)
**🔗 Frontend repo:** [https://github.com/tirthosarkar/trailnest-client.git](https://github.com/tirthosarkar/trailnest-backend.git)

---

## Table of Contents

- [About](#about)
- [Table of Contents](#table-of-contents)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Authentication](#authentication)
- [API Reference](#api-reference)
  - [Listings](#listings)
  - [Bookings](#bookings)
  - [User](#user)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Deployment](#deployment)
- [Roadmap](#roadmap)
- [Author](#author)

---

## Features

- 🔐 **Session-based auth guard** — Every protected route verifies a Bearer token directly against BetterAuth's `session` collection, then resolves the owning user from the `user` collection.
- 🔎 **Paginated, filterable listings** — `/listing` supports search (name + description, case-insensitive), listing type, price range, and configurable sort field/order, and returns full pagination metadata.
- 📆 **Real conflict-checked bookings** — Campsite bookings are validated against every existing _confirmed_ booking for that listing using a three-way MongoDB `$or` overlap check ($gte/$lt, $gt/$lte, and full-containment), rejecting any date range that overlaps.
- 🏷️ **Dual listing types** — Campsites are booked by date range (`startDate`/`endDate`/`guests`); gear is booked by `quantity`, with type-specific fields only attached where relevant.
- 🧮 **Live booking counts** — Every listing response includes a freshly counted `bookingCount`, and it's incremented/decremented on booking creation/cancellation.
- 🔒 **Ownership checks on every mutation** — Update, delete, and cancel routes all confirm the authenticated user matches the resource's `ownerEmail` / `userEmail` before touching the database.
- ☁️ **Zero-build serverless deploy** — Ships straight to Vercel as a Node function via `vercel.json`, no separate build step required in production routing.

---

## Tech Stack

| Layer          | Technology                                                            |
| -------------- | --------------------------------------------------------------------- |
| **Runtime**    | Node.js, Express 5                                                    |
| **Language**   | TypeScript (`ts-node-dev` in dev, `tsc` build)                        |
| **Database**   | MongoDB — native driver, no ODM                                       |
| **Auth**       | Bearer-token lookup against BetterAuth's `session`/`user` collections |
| **CORS**       | `cors` middleware                                                     |
| **Deployment** | Vercel (`@vercel/node` builder)                                       |

---

## Authentication

TrailNest doesn't run its own auth system on the backend — it trusts the **same MongoDB database** that the Next.js frontend's BetterAuth instance writes to.

1. The frontend signs a user in via BetterAuth, which creates a document in the `session` collection.
2. The frontend calls `authClient.token()` to get that session token and sends it as `Authorization: Bearer <token>`.
3. The `verifyToken` middleware here looks the token up directly in `sessionCollection`, then resolves the user from `userCollection` and attaches it to `req.user`.
4. If the token is missing, not found, or the user no longer exists, the request is rejected with `401`.

```ts
const authHeader = req.headers.authorization;
const token = authHeader?.split(" ")[1];
const session = await sessionCollection.findOne({ token });
const user = await userCollection.findOne({ _id: session.userId });
req.user = user;
```

This means the backend and frontend **must** point at the same `MONGO_DB_URI` / `AUTH_DB_NAME` — there's no JWT secret or signing key shared between them, just a shared database.

---

## API Reference

Base URL: `https://trailnest-backend-alpha.vercel.app`
🔒 = requires `Authorization: Bearer <session-token>`

### Listings

<details>
<summary><code>GET /listing</code> — Paginated, filterable listing search</summary>

**Query params** (all optional):

| Param       | Type   | Default     | Description                                                        |
| ----------- | ------ | ----------- | ------------------------------------------------------------------ |
| `page`      | number | `1`         | Page number                                                        |
| `limit`     | number | `12`        | Items per page                                                     |
| `search`    | string | —           | Matches against `name` and `description` (regex, case-insensitive) |
| `type`      | string | —           | `campsite` or `gear`                                               |
| `minPrice`  | number | `0`         | Minimum `pricePerDay`                                              |
| `maxPrice`  | number | `999999`    | Maximum `pricePerDay`                                              |
| `sortBy`    | string | `createdAt` | Any listing field                                                  |
| `sortOrder` | string | `desc`      | `asc` or `desc`                                                    |

**Response**

```json
{
  "data": [{ "_id": "...", "name": "...", "bookingCount": 3, "...": "..." }],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalItems": 54,
    "itemsPerPage": 12,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

</details>

<details>
<summary><code>GET /featured</code> — Latest listings for the homepage</summary>

Returns the most recently created listings, sorted by `createdAt` descending. No pagination — used for the homepage's featured carousel.

</details>

<details>
<summary><code>GET /listing/:id</code> — Single listing by ID</summary>

Returns `404` if the ID isn't a valid ObjectId or no listing matches.

</details>

<details>
<summary>🔒 <code>POST /listing</code> — Create a listing</summary>

**Body** — required: `name`, `description`, `image`, `type`, `location`, `capacity`, `pricePerDay`.

The server attaches `ownerId`, `ownerEmail` (from the authenticated user), `bookingCount: 0`, `createdAt`, and `updatedAt` automatically — don't send these.

Returns `400` if any required field is missing, `201` with the created document on success.

</details>

<details>
<summary>🔒 <code>PUT /listing/:id</code> — Update a listing</summary>

Owner-only — the server checks `ownerEmail` against the authenticated user before applying updates.

</details>

<details>
<summary>🔒 <code>DELETE /listing/:id</code> — Delete a listing</summary>

Owner-only, same ownership check as `PUT`.

</details>

<details>
<summary>🔒 <code>GET /my-listings</code> — Listings owned by the current user</summary>

Filters by `ownerEmail === req.user.email`, sorted newest first.

</details>

### Bookings

<details>
<summary>🔒 <code>POST /bookings</code> — Create a booking</summary>

**Body**:

| Field         | Type   | Required            | Notes                               |
| ------------- | ------ | ------------------- | ----------------------------------- |
| `listingId`   | string | ✅                  | Must be a valid ObjectId            |
| `listingType` | string | ✅                  | `campsite` or `gear`                |
| `totalPrice`  | number | ✅                  |                                     |
| `startDate`   | string | ✅ if `campsite`    | ISO date                            |
| `endDate`     | string | ✅ if `campsite`    | ISO date, must be after `startDate` |
| `guests`      | number | optional (campsite) | Defaults to `1`                     |
| `quantity`    | number | optional (gear)     | Defaults to `1`                     |
| `specialNote` | string | optional            |                                     |

**Campsite validation:**

- `startDate` must be today or later.
- `endDate` must be after `startDate`.
- Rejected with `409 Date conflict` if the range overlaps any existing **confirmed** booking for that listing — checked with a three-branch MongoDB `$or` (new booking starts inside an existing one, ends inside an existing one, or fully contains an existing one).

On success, increments the listing's `bookingCount` and returns `201` with the created booking.

</details>

<details>
<summary><code>GET /bookings/listing/:listingId</code> — Confirmed date ranges for a listing</summary>

Public route — returns only `startDate`, `endDate`, and `status` for every confirmed booking on a listing. Used by the frontend to gray out unavailable dates before submitting.

</details>

<details>
<summary>🔒 <code>GET /my-bookings</code> — Current user's bookings</summary>

Returns bookings for `req.user.email`, each joined with its full listing document under a `listing` key (`null` if the listing was since deleted).

</details>

<details>
<summary>🔒 <code>DELETE /bookings/:id</code> — Cancel a booking</summary>

Booking-owner-only (`userEmail` check). Sets `status: "cancelled"` (soft delete, not a real delete) and decrements the listing's `bookingCount`.

</details>

### User

<details>
<summary>🔒 <code>GET /me</code> — Current authenticated user</summary>

Returns the `req.user` object resolved by the auth middleware.

</details>

---

## Getting Started

### Prerequisites

- Node.js 18+
- A MongoDB connection string — **the same database** your [TrailNest frontend](https://github.com/tirthosarkar/trailnest-client.git)'s BetterAuth instance uses, since this server reads its `session`/`user` collections directly.

### Installation

```bash
git clone https://github.com/tirthosarkar/trailnest-backend.git
cd trailnest-backend
npm install
```

Copy the environment variables below into a `.env` file, then:

```bash
npm run dev
```

The API will be running at `http://localhost:5000`.

---

## Environment Variables

Create a `.env` file in the project root:

```env
PORT=5000
MONGO_DB_URI=your_mongodb_connection_string
AUTH_DB_NAME=your_auth_database_name
```

> `AUTH_DB_NAME` must match the database BetterAuth is configured to use on the frontend, or session lookups will always fail.

---

## Available Scripts

| Command         | Description                                             |
| --------------- | ------------------------------------------------------- |
| `npm run dev`   | Start with `ts-node-dev` (auto-restart on file changes) |
| `npm run build` | Compile TypeScript to `dist/` via `tsc`                 |
| `npm run start` | Run the compiled build (`node dist/index.js`)           |

---

## Deployment

Deployed on Vercel as a serverless Node function. `vercel.json` routes every request straight to `index.ts` via the `@vercel/node` builder — no separate build command needed for the platform itself, though `npm run build` is still useful for catching type errors locally before pushing.

```json
{
  "version": 2,
  "builds": [{ "src": "index.ts", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "index.ts" }]
}
```

---

## Roadmap

- [ ] Move off `any` types on `filter`/`sort`/`booking` objects for full type safety
- [ ] Split `index.ts` into routes/controllers as the API grows
- [ ] Rate limiting on public search endpoints
- [ ] Gear availability conflict checks (currently only campsites check for date overlaps)

---

## Author

**Tirtho Sarkar**
Frontend-focused developer building toward full-stack (MERN)

- GitHub: [@tirthosarkar](https://github.com/tirthosarkar)

<br />

<div align="center">
  <sub>The engine room behind <a href="https://trailnest-client.vercel.app/">TrailNest</a>.</sub>
</div>