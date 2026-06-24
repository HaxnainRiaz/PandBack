const mongoose = require('mongoose');

const cached = globalThis.mongoose || {
    conn: null,
    promise: null,
    listenersAttached: false
};
globalThis.mongoose = cached;

function attachConnectionListeners() {
    if (cached.listenersAttached) return;
    cached.listenersAttached = true;

    mongoose.connection.on('disconnected', () => {
        cached.conn = null;
        cached.promise = null;
        console.warn('[MongoDB] Connection closed');
    });
    mongoose.connection.on('error', (error) => {
        console.error('[MongoDB] Connection error:', error.message);
    });
}

async function connectDB() {
    const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
    if (!uri) throw new Error('MONGODB_URI is not configured');

    const dbName = uri.split('?')[0].split('/').pop();
    if (!dbName) throw new Error('MONGODB_URI must include a database name');

    if (cached.conn && mongoose.connection.readyState === 1) return cached.conn;
    if (cached.promise) return cached.promise;

    attachConnectionListeners();
    console.log('[MongoDB] Creating connection');

    cached.promise = mongoose.connect(uri, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 20000,
        maxPoolSize: 5,
        minPoolSize: 0,
        maxIdleTimeMS: 30000,
        retryReads: true,
        retryWrites: true,
        autoIndex: false
    }).then((connection) => {
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

module.exports = connectDB;
