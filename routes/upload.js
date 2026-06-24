const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const multer = require('multer');
const cloudinaryStorage = require('../services/cloudinaryImageStorage');
const localStorage = require('../services/localImageStorage');

const router = express.Router();

const isVercel = Boolean(process.env.VERCEL);
const MAX_FILE_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 10 * 1024 * 1024;

const ALLOWED_MIME = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/avif'
]);

let cachedProvider = null;
let cloudinaryVerified = null;

function getRequestedProvider() {
    return (process.env.UPLOAD_PROVIDER || 'auto').trim().toLowerCase();
}

function allowLocalFallback() {
    if (isVercel) return false;
    const flag = (process.env.ALLOW_LOCAL_UPLOAD_FALLBACK || 'true').trim().toLowerCase();
    return flag === 'true' || flag === '1';
}

async function resolveActiveProvider(forceRefresh = false) {
    const requested = getRequestedProvider();

    if (requested === 'local') {
        cachedProvider = 'local';
        return cachedProvider;
    }

    if (requested === 'cloudinary') {
        if (!cloudinaryStorage.isCloudinaryConfigured()) {
            throw new Error('Cloudinary env vars are missing');
        }
        if (forceRefresh || cloudinaryVerified === null) {
            cloudinaryVerified = await cloudinaryStorage.verifyCloudinaryCredentials();
        }
        if (!cloudinaryVerified.ok) {
            throw new Error(cloudinaryVerified.message || 'Cloudinary credentials are invalid');
        }
        cachedProvider = 'cloudinary';
        return cachedProvider;
    }

    // auto: prefer Cloudinary when valid, otherwise local disk (local dev only)
    if (cloudinaryStorage.isCloudinaryConfigured()) {
        if (forceRefresh || cloudinaryVerified === null) {
            cloudinaryVerified = await cloudinaryStorage.verifyCloudinaryCredentials();
        }
        if (cloudinaryVerified.ok) {
            cachedProvider = 'cloudinary';
            return cachedProvider;
        }
    }

    if (allowLocalFallback()) {
        cachedProvider = 'local';
        return cachedProvider;
    }

    const reason = cloudinaryVerified?.message ||
        'Cloudinary is not configured or credentials are invalid. Set correct CLOUDINARY_CLOUD_NAME (from dashboard), API key, and secret.';
    throw new Error(reason);
}

const memoryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES }
});

router.get('/status', async (req, res) => {
    try {
        const provider = await resolveActiveProvider(true);
        const cloudinaryCheck = cloudinaryVerified || await cloudinaryStorage.verifyCloudinaryCredentials();

        return res.status(200).json({
            success: true,
            data: {
                requestedProvider: getRequestedProvider(),
                activeProvider: provider,
                cloudinaryConfigured: cloudinaryStorage.isCloudinaryConfigured(),
                cloudinaryVerified: cloudinaryCheck.ok,
                cloudinaryError: cloudinaryCheck.ok ? null : (cloudinaryCheck.message || 'Invalid credentials'),
                localFallbackEnabled: allowLocalFallback(),
                maxBytes: MAX_FILE_BYTES,
                allowedTypes: Array.from(ALLOWED_MIME),
                variants: cloudinaryStorage.VARIANTS.map((v) => v.name)
            }
        });
    } catch (error) {
        return res.status(200).json({
            success: true,
            data: {
                requestedProvider: getRequestedProvider(),
                activeProvider: null,
                cloudinaryConfigured: cloudinaryStorage.isCloudinaryConfigured(),
                cloudinaryVerified: false,
                cloudinaryError: error.message,
                localFallbackEnabled: allowLocalFallback(),
                maxBytes: MAX_FILE_BYTES
            }
        });
    }
});

router.post('/', async (req, res, next) => {
    try {
        await resolveActiveProvider();
        return next();
    } catch (error) {
        return res.status(503).json({
            success: false,
            code: 'IMAGE_STORAGE_NOT_CONFIGURED',
            message: error.message,
            hint: 'For local dev set UPLOAD_PROVIDER=local or fix CLOUDINARY_CLOUD_NAME in PandBack/.env (Dashboard → Cloud name).'
        });
    }
}, memoryUpload.single('image'), async (req, res) => {
    let provider = 'cloudinary';
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                code: 'NO_FILE',
                message: 'No file uploaded'
            });
        }

        if (!ALLOWED_MIME.has(req.file.mimetype)) {
            return res.status(400).json({
                success: false,
                code: 'UNSUPPORTED_IMAGE_TYPE',
                message: 'Only JPG, PNG, WEBP, and AVIF images are allowed'
            });
        }

        if (req.file.size > MAX_FILE_BYTES) {
            return res.status(400).json({
                success: false,
                code: 'IMAGE_TOO_LARGE',
                message: `Image must be smaller than ${Math.round(MAX_FILE_BYTES / (1024 * 1024))}MB`
            });
        }

        provider = await resolveActiveProvider();
        const image = provider === 'local'
            ? await localStorage.saveImageVariants(req.file.buffer, req.file.originalname, req)
            : await cloudinaryStorage.saveImageVariants(req.file.buffer, req.file.originalname);

        return res.status(200).json({
            success: true,
            message: 'Image uploaded and optimized',
            data: {
                image,
                url: image.originalUrl,
                variants: image.variants,
                provider
            }
        });
    } catch (error) {
        console.error('[Upload] Processing failed:', error.message);

        if (provider !== 'local' && allowLocalFallback() && error?.http_code === 401) {
            try {
                const image = await localStorage.saveImageVariants(req.file.buffer, req.file.originalname, req);
                return res.status(200).json({
                    success: true,
                    message: 'Image uploaded locally (Cloudinary auth failed)',
                    data: { image, url: image.originalUrl, variants: image.variants, provider: 'local' }
                });
            } catch (localErr) {
                console.error('[Upload] Local fallback failed:', localErr.message);
            }
        }

        return res.status(500).json({
            success: false,
            code: error?.http_code === 401 ? 'CLOUDINARY_AUTH_FAILED' : 'UNKNOWN_SERVER_ERROR',
            message: error?.http_code === 401
                ? 'Cloudinary credentials are invalid. Use UPLOAD_PROVIDER=local for local dev, or fix CLOUDINARY_CLOUD_NAME in .env.'
                : 'Image upload failed',
            details: process.env.NODE_ENV !== 'production' ? error.message : undefined
        });
    }
});

router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                code: 'IMAGE_TOO_LARGE',
                message: `Image must be smaller than ${Math.round(MAX_FILE_BYTES / (1024 * 1024))}MB`
            });
        }
        return res.status(400).json({
            success: false,
            code: 'UPLOAD_ERROR',
            message: err.message
        });
    }
    return next(err);
});

module.exports = router;
