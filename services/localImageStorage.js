const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const VARIANTS = [
    { name: 'thumb', width: 160 },
    { name: 'small', width: 320 },
    { name: 'medium', width: 800 },
    { name: 'large', width: 1200 }
];

function getUploadsDir() {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'products');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getPublicBaseUrl(req) {
    if (req) {
        const host = req.get('host');
        if (host) {
            const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
            if (isLocal || !process.env.BACKEND_URL) {
                const protocol = req.protocol || 'http';
                return `${protocol}://${host}`;
            }
        }
    }

    if (process.env.BACKEND_URL) {
        return process.env.BACKEND_URL.replace(/\/$/, '');
    }

    return `http://localhost:${process.env.PORT || 5000}`;
}

async function saveImageVariants(fileBuffer, originalName, req) {
    const imageId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const imageDir = path.join(getUploadsDir(), imageId);
    fs.mkdirSync(imageDir, { recursive: true });

    const metadata = await sharp(fileBuffer).rotate().metadata();
    const variants = {};

    for (const variant of VARIANTS) {
        const fileName = `${variant.name}.webp`;
        const filePath = path.join(imageDir, fileName);

        await sharp(fileBuffer)
            .rotate()
            .resize({ width: variant.width, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(filePath);

        variants[variant.name] = `${getPublicBaseUrl(req)}/uploads/products/${imageId}/${fileName}`;
    }

    const primaryUrl = variants.medium || variants.large || Object.values(variants)[0];

    return {
        alt: originalName || '',
        provider: 'local',
        publicId: `products/${imageId}`,
        width: metadata.width || null,
        height: metadata.height || null,
        format: 'webp',
        sizeBytes: fileBuffer.length,
        variants,
        originalUrl: primaryUrl
    };
}

module.exports = { saveImageVariants, VARIANTS };
