const Banner = require('../models/Banner');
const { createLog } = require('./auditController');
const socketUtil = require('../utils/socket');

exports.getBanners = async (req, res) => {
    try {
        const banners = await Banner.find().select('title subtitle image link buttonText isActive order').sort({ order: 1 }).lean();
        res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
        res.status(200).json({ success: true, data: banners });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.createBanner = async (req, res) => {
    try {
        const banner = await Banner.create(req.body);
        await createLog(req.user.id, 'Banner Creation', `Added new hero banner: ${banner.title}`);

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('banner:new', banner);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(201).json({ success: true, data: banner });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateBanner = async (req, res) => {
    try {
        const banner = await Banner.findByIdAndUpdate(req.params.id, req.body, { new: true });
        await createLog(req.user.id, 'Banner Update', `Updated banner: ${banner.title}`);

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('banner:update', banner);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: banner });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.deleteBanner = async (req, res) => {
    try {
        await Banner.findByIdAndDelete(req.params.id);

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('banner:delete', { id: req.params.id });
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
