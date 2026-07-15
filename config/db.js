const mongoose = require('mongoose');

const cached = globalThis.mongoose || {
    conn: null,
    promise: null,
    listenersAttached: false,
    reconnecting: false
};
globalThis.mongoose = cached;

function attachConnectionListeners() {
    if (cached.listenersAttached) return;
    cached.listenersAttached = true;

    mongoose.connection.on('connected', () => {
        cached.reconnecting = false;
        console.log('[MongoDB] Connection established');
    });

    mongoose.connection.on('disconnected', () => {
        cached.conn = null;
        cached.promise = null;
        console.warn('[MongoDB] Connection closed — will reconnect on next request');
    });

    mongoose.connection.on('error', (error) => {
        console.error('[MongoDB] Connection error:', error.message);
    });
}

function isDbReady() {
    return mongoose.connection.readyState === 1;
}

async function connectDB() {
    const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
    if (!uri) throw new Error('MONGODB_URI is not configured');

    const dbName = uri.split('?')[0].split('/').pop();
    if (!dbName) throw new Error('MONGODB_URI must include a database name');

    if (cached.conn && isDbReady()) return cached.conn;
    if (cached.promise) return cached.promise;

    attachConnectionListeners();
    console.log('[MongoDB] Creating connection');

    const options = {
        bufferCommands: false,
        serverSelectionTimeoutMS: 15000,
        connectTimeoutMS: 15000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        minPoolSize: 1,
        maxIdleTimeMS: 60000,
        heartbeatFrequencyMS: 10000,
        retryReads: true,
        retryWrites: true,
        autoIndex: false
    };

    cached.promise = mongoose.connect(uri, options).then((connection) => {
        cached.conn = connection;
        console.log(`[MongoDB] Connected to ${connection.connection.name}`);
        return connection;
    }).catch((error) => {
        cached.conn = null;
        cached.promise = null;
        throw error;
    });

    return cached.promise;
}

/**
 * Ensure DB is connected; retries transient failures (cold start, brief blip).
 */
async function ensureDbConnected(maxAttempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            if (isDbReady()) return mongoose.connection;
            await connectDB();
            if (isDbReady()) return mongoose.connection;
        } catch (error) {
            lastError = error;
            cached.conn = null;
            cached.promise = null;
            if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, attempt * 400));
            }
        }
    }
    throw lastError || new Error('Database connection failed');
}

module.exports = connectDB;
module.exports.ensureDbConnected = ensureDbConnected;
module.exports.isDbReady = isDbReady;
