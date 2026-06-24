const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const dns = require('dns');

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const isVercel = Boolean(process.env.VERCEL);
const serverStartedAt = Date.now();

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
if (!isProduction) {
    console.log('✅ DNS servers configured: Using Google DNS (8.8.8.8) to bypass local DNS issues');
}

const connectDB = require('./config/db');
const Media = require('./models/Media');

const app = express();

const allowedOrigins = [
    process.env.CLIENT_URL,
    process.env.FRONTEND_URL,
    process.env.ADMIN_APP_URL,
    process.env.WEBSTORE_URL,
    process.env.BACKEND_URL,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5000',
    'https://store-pannel.vercel.app',
    'https://store-admin-one.vercel.app',
    'https://luminelle.org'
].filter(Boolean);

const isLightweightRoute = (path) => path === '/' || path === '/health';

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization, Accept');

    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    credentials: true
}));

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        console.log(JSON.stringify({
            method: req.method,
            path: req.originalUrl || req.path,
            statusCode: res.statusCode,
            durationMs: Date.now() - start,
            userAgent: req.get('user-agent') || ''
        }));
    });
    next();
});

app.get('/', (req, res) => {
    res.status(200).json({
        message: 'Backend API is running',
        health: '/health'
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'backend',
        uptime: Math.floor((Date.now() - serverStartedAt) / 1000),
        timestamp: new Date().toISOString()
    });
});

if (!isProduction && !isVercel) {
    connectDB().catch(err => console.error('Initial DB Connection Error:', err));
}

app.use(async (req, res, next) => {
    if (isLightweightRoute(req.path)) return next();

    try {
        if (mongoose.connection.readyState !== 1) {
            await connectDB();
        }
        global.isDbConnected = true;
        next();
    } catch (error) {
        global.isDbConnected = false;
        console.error('Middleware DB Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Database connection failed',
            error: error.message
        });
    }
});

app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

app.get('/uploads/:filename', async (req, res) => {
    try {
        const { filename } = req.params;

        const media = await Media.findOne({ filename });
        if (media && media.data) {
            res.set({
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Access-Control-Allow-Origin': '*',
                'Content-Security-Policy': "default-src 'self'",
                'X-Content-Type-Options': 'nosniff'
            });
            res.type(media.contentType);
            return res.send(media.data);
        }

        const localPath = path.join(__dirname, 'public/uploads', filename);
        if (fs.existsSync(localPath)) {
            res.set('Cache-Control', 'public, max-age=86400');
            return res.sendFile(localPath);
        }

        res.status(404).json({ success: false, message: 'Image not found' });
    } catch (error) {
        console.error('Error serving image:', error);
        res.status(500).send('Internal Server Error');
    }
});

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const cmsRoutes = require('./routes/cms');
const categoryRoutes = require('./routes/categories');
const userRoutes = require('./routes/users');
const couponRoutes = require('./routes/coupons');
const reviewRoutes = require('./routes/reviews');
const statsRoutes = require('./routes/stats');
const ticketRoutes = require('./routes/tickets');
const auditRoutes = require('./routes/audit');
const bannerRoutes = require('./routes/banners');
const settingsRoutes = require('./routes/settings');
const newsletterRoutes = require('./routes/newsletter');
const seoRoutes = require('./routes/seo');
const supportTicketRoutes = require('./routes/support-tickets');
const blogRoutes = require('./routes/blogRoutes');
const uploadRoutes = require('./routes/upload');
const postexRoutes = require('./routes/postex');
const metaRoutes = require('./routes/meta');
const publicMetaRoutes = require('./routes/publicMeta');
const trackingRoutes = require('./routes/tracking');

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cms', cmsRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/seo', seoRoutes);
app.use('/api/support-tickets', supportTicketRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/postex', postexRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/store/meta', publicMetaRoutes);
app.use('/api/tracking', trackingRoutes);

const workersEnabled =
    !isVercel &&
    (process.env.ENABLE_WORKERS === 'true' || process.env.ENABLE_TRACKING_WORKER === 'true');

if (workersEnabled) {
    const { processPendingQueue } = require('./services/metaQueueService');
    console.log('🔄 [Meta Queue Worker] Starting background sync (every 60s, local/long-running only)...');
    setInterval(async () => {
        try {
            await processPendingQueue(25);
        } catch (err) {
            console.error('❌ [Meta Queue Worker Error]:', err.message);
        }
    }, 60000);
} else if (isVercel) {
    console.log('ℹ️ Background workers disabled on Vercel (set ENABLE_WORKERS=true on Railway/Render for queue processing)');
}

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`
    });
});

app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Server Error'
    });
});

let server;

if (!isVercel) {
    const http = require('http');
    const socketUtil = require('./utils/socket');

    server = http.createServer(app);
    const io = socketUtil.init(server);

    io.on('connection', (socket) => {
        socket.on('disconnect', () => {});
    });

    const PORT = process.env.PORT || 5000;

    const startServer = (retries = 3) => {
        if (process.env.NODE_ENV !== 'production') {
            try {
                const { execSync } = require('child_process');
                const stdout = execSync(`netstat -ano | findstr :${PORT} | findstr LISTENING`).toString();
                const pids = new Set();

                stdout.split('\r\n').forEach(line => {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && /^\d+$/.test(pid) && pid !== '0' && pid !== process.pid.toString()) {
                        pids.add(pid);
                    }
                });

                if (pids.size > 0) {
                    console.log(`[CLEANUP] Force-killing processes on port ${PORT}: ${Array.from(pids).join(', ')}`);
                    pids.forEach(pid => {
                        try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch (e) { }
                    });
                    const Atomics = require('atomics');
                    const SharedArrayBuffer = require('sharedarraybuffer').SharedArrayBuffer || require('worker_threads').SharedArrayBuffer;
                    if (SharedArrayBuffer) {
                        const sab = new SharedArrayBuffer(4);
                        const int32 = new Int32Array(sab);
                        Atomics.wait(int32, 0, 0, 1000);
                    }
                }
            } catch (err) { /* No process found */ }
        }

        server.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        }).on('error', (err) => {
            if (err.code === 'EADDRINUSE' && retries > 0) {
                console.log(`[RETRY] Port ${PORT} busy, retrying in 1.5s... (${retries} left)`);
                setTimeout(() => startServer(retries - 1), 1500);
            } else {
                console.error('[FATAL] Server failed to start:', err);
                process.exit(1);
            }
        });
    };

    startServer();

    if (process.env.ENABLE_MEMORY_WATCHER === 'true') {
        require('./scratch/memory_growth_watcher');
    }
}

module.exports = isVercel ? app : server;
