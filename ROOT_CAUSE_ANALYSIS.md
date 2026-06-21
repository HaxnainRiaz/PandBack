# Root Cause Analysis: MongoDB Data Loss on Vercel Redeployment

## Summary
The investigation into the reported data loss after backend redeployments identified several high-risk areas. While no explicit "drop database" commands were found in the runtime logic, the combination of non-persistent serverless execution, insecure database connection patterns, and the presence of destructive utility scripts created a high probability for accidental data loss or apparent "disappearance" of data.

## Identified Root Causes

### 1. Insecure Connection Pattern (Connection Fragmentation)
**Original Status:** The application used a standard `mongoose.connect()` call in a "floating" promise at the top of `server.js`.
**Impact:** In a serverless environment like Vercel, this pattern is unreliable. If the connection fails for one instance but succeeds for another, or if the environment variable `MONGODB_URI` was missing or misconfigured in a specific Vercel "Preview" or "Production" environment, the app might have silently connected to an empty "test" database or failed to persist data correctly across instances.

### 2. Ambiguous Database Naming
**Original Status:** The `MONGODB_URI` was used without checking if it explicitly defined a database name.
**Impact:** If the URI provided in Vercel environment variables was `mongodb+srv://user:pass@cluster.mongodb.net/`, MongoDB drivers default to the `test` database. If a developer later updated the URI to include `/production`, the existing data in `test` would appear to have "disappeared."

### 3. Destructive Utility Scripts
**Original Status:** Scripts like `resetDatabase.js` were present in the codebase and reachable via `npm run reset`.
**Impact:** While not automated, these scripts represent a "loaded gun." Any accidental execution (e.g., via a misconfigured build command or CI/CD script) would immediately wipe the database.

## Implemented Fixes

### 1. Serverless-Safe Connection Pattern
Refactored `config/db.js` to use a **Global Cached Connection**.
- **Logic:** The connection promise is stored in a global variable. Subsequent requests check this cache before attempting a new connection.
- **Benefit:** Prevents connection exhaustion and ensures path-identical connectivity across all serverless function hot-starts.

### 2. Strict Middleware Enforcement
Moved the database connection check into a global Express middleware in `server.js`.
- **Logic:** `app.use(async (req, res, next) => { await connectDB(); next(); })`
- **Benefit:** The application now guarantees a valid database connection **before** any business logic or routing is executed. If the connection fails, the request fails with a 500 error instead of running with undefined state.

### 3. URI Validation (Fail-Fast)
Added strict validation to `config/db.js` to ensure that:
- `MONGODB_URI` is present.
- **An explicit database name is defined** in the URI string.
- **Benefit:** Prevents the application from accidentally writing to or reading from the default `test` database.

### 4. Removal of Destructive Code
User has deleted `resetDatabase.js`. I have verified that no other part of the production runtime contains `deleteMany()` or `dropDatabase()` calls.

---
**Status:** ✅ Production environment is now secured against the identified data loss vectors.
