/**
 * Extracts the real client IP from proxy headers (Vercel, Cloudflare, etc.)
 */
const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const realIp = req.headers['x-real-ip'];
    const cfIp = req.headers['cf-connecting-ip'];

    let ip = forwarded || realIp || cfIp || req.ip || req.socket?.remoteAddress;

    if (ip && typeof ip === 'string' && ip.includes(',')) {
        ip = ip.split(',')[0].trim();
    }

    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
        ip = '127.0.0.1';
    }

    if (ip && ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }

    return ip || undefined;
};

module.exports = { getClientIp };
