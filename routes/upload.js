const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const router = express.Router();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storageConfigured = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

// Stream uploads to external storage. Never buffer files in a Vercel function
// or store image bytes inside MongoDB.
const upload = multer({
    storage: new CloudinaryStorage({
        cloudinary,
        params: {
            folder: 'panda_emart',
            allowed_formats: ['jpg', 'png', 'webp', 'jpeg']
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }
});

router.post('/', (req, res, next) => {
    if (!storageConfigured) {
        return res.status(503).json({
            success: false,
            message: 'Image storage is not configured'
        });
    }
    return next();
}, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    return res.status(200).json({
        success: true,
        url: req.file.path || req.file.secure_url,
        fileName: req.file.filename || req.file.public_id
    });
});

module.exports = router;
