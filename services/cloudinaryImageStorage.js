const sharp = require('sharp');
const cloudinary = require('cloudinary').v2;

const VARIANTS = [
    { name: 'thumb', width: 160 },
    { name: 'small', width: 320 },
    { name: 'medium', width: 800 },
    { name: 'large', width: 1200 }
];

function refreshCloudinaryConfig() {
    cloudinary.config({
        cloud_name: (process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
        api_key: (process.env.CLOUDINARY_API_KEY || '').trim(),
        api_secret: (process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_API_SECRE || '').trim()
    });
}

function isCloudinaryConfigured() {
    return Boolean(
        (process.env.CLOUDINARY_CLOUD_NAME || '').trim() &&
        (process.env.CLOUDINARY_API_KEY || '').trim() &&
        (process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_API_SECRE || '').trim()
    );
}

async function verifyCloudinaryCredentials() {
    if (!isCloudinaryConfigured()) {
        return { ok: false, reason: 'missing_env' };
    }

    refreshCloudinaryConfig();

    try {
        const result = await cloudinary.api.ping();
        return { ok: true, result };
    } catch (error) {
        return {
            ok: false,
            reason: 'auth_failed',
            message: error?.error?.message || error.message || 'Cloudinary authentication failed'
        };
    }
}

function uploadBufferToCloudinary(buffer, publicId) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                public_id: publicId,
                folder: 'panda_emart',
                resource_type: 'image',
                format: 'webp',
                overwrite: true
            },
            (error, result) => {
                if (error) return reject(error);
                return resolve(result);
            }
        );
        stream.end(buffer);
    });
}

async function saveImageVariants(fileBuffer, originalName) {
    refreshCloudinaryConfig();

    const imageId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const basePublicId = `products/${imageId}`;
    const metadata = await sharp(fileBuffer).rotate().metadata();
    const variants = {};
    let primaryUrl = null;

    for (const variant of VARIANTS) {
        const processed = await sharp(fileBuffer)
            .rotate()
            .resize({ width: variant.width, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();

        const result = await uploadBufferToCloudinary(processed, `${basePublicId}/${variant.name}`);
        variants[variant.name] = result.secure_url;
        if (variant.name === 'medium') {
            primaryUrl = result.secure_url;
        }
    }

    if (!primaryUrl) {
        primaryUrl = variants.large || variants.small || Object.values(variants)[0];
    }

    return {
        alt: originalName || '',
        provider: 'cloudinary',
        publicId: `panda_emart/${basePublicId}`,
        width: metadata.width || null,
        height: metadata.height || null,
        format: 'webp',
        sizeBytes: fileBuffer.length,
        variants,
        originalUrl: primaryUrl
    };
}

module.exports = {
    VARIANTS,
    isCloudinaryConfigured,
    verifyCloudinaryCredentials,
    saveImageVariants
};
