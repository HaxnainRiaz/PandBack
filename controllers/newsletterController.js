const Newsletter = require('../models/Newsletter');
const socketUtil = require('../utils/socket');

exports.subscribe = async (req, res) => {
    try {
        const subscriber = await Newsletter.create(req.body);

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('newsletter:new', subscriber);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(201).json({ success: true, data: subscriber });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ success: false, message: 'Already subscribed' });
        }
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.getSubscribers = async (req, res) => {
    try {
        const subscribers = await Newsletter.find().sort('-createdAt');
        res.status(200).json({ success: true, data: subscribers });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.unsubscribe = async (req, res) => {
    try {
        await Newsletter.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
