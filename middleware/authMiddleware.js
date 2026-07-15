const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ensureDbConnected, isDbReady } = require('../config/db');

async function loadUserWithRetry(userId, maxAttempts = 2) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            if (!isDbReady()) {
                await ensureDbConnected(2);
            }
            const user = await User.findById(userId).maxTimeMS(12000);
            return user;
        } catch (err) {
            lastError = err;
            if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, 300));
            }
        }
    }
    throw lastError;
}

exports.protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        console.error('Token Verification Error:', err.message);
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    try {
        await ensureDbConnected(3);
        req.user = await loadUserWithRetry(decoded.id);

        if (!req.user) {
            return res.status(401).json({ success: false, message: 'User not found with this token' });
        }

        if (req.user.status === 'banned') {
            return res.status(403).json({ success: false, message: 'Your account has been suspended. Please contact support.' });
        }

        next();
    } catch (err) {
        console.error('Database connection or lookup error during auth:', err.message);
        return res.status(503).json({
            success: false,
            message: 'Database temporarily unavailable. Please try again shortly.',
            retryable: true
        });
    }
};

exports.optional = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return next();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (isDbReady()) {
            req.user = await User.findById(decoded.id).maxTimeMS(8000);
        }
    } catch (err) {
        // Invalid token or DB unavailable — proceed as guest
    }
    next();
};

exports.authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `User role ${req.user.role} is not authorized to access this route`
            });
        }
        next();
    };
};
