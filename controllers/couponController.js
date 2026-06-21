const Coupon = require('../models/Coupon');
const { createLog } = require('./auditController');
const socketUtil = require('../utils/socket');

exports.getCoupons = async (req, res) => {
    try {
        const coupons = await Coupon.find()
            .populate('bundleProducts.product')
            .populate('buyXGetY.buyProducts')
            .populate('buyXGetY.getProducts')
            .populate('quantityDiscount.products')
            .sort('-createdAt');
        res.status(200).json({ success: true, data: coupons });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.createCoupon = async (req, res) => {
    try {
        // Map frontend fields (value -> discountValue, minimumSpend -> minAmount)
        if (req.body.value !== undefined) req.body.discountValue = req.body.value;
        if (req.body.minimumSpend !== undefined) req.body.minAmount = req.body.minimumSpend;

        const coupon = await Coupon.create(req.body);

        // Audit Log
        if (req.user) {
            await createLog(req.user.id, 'Promotion Creation', `Created coupon: ${coupon.code}`);
        }

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('coupon:new', coupon);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(201).json({ success: true, data: coupon });
    } catch (err) {
        console.error('Coupon Creation Error:', err);
        
        // Handle duplicate code error
        if (err.code === 11000) {
            return res.status(400).json({ success: false, message: 'Coupon code already exists' });
        }

        res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
    }
};

exports.updateCoupon = async (req, res) => {
    try {
        const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        // Audit Log
        await createLog(req.user.id, 'Promotion Update', `Updated coupon: ${coupon.code}`);

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('coupon:update', coupon);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: coupon });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.deleteCoupon = async (req, res) => {
    try {
        const coupon = await Coupon.findById(req.params.id);
        if (coupon) {
            const couponCode = coupon.code;
            await Coupon.findByIdAndDelete(req.params.id);

            // Audit Log
            await createLog(req.user.id, 'Promotion Deletion', `Deleted coupon: ${couponCode}`);
        }

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('coupon:delete', { id: req.params.id });
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Validate coupon code
// @route   GET /api/coupons/validate/:code
// @access  Public
exports.validateCoupon = async (req, res) => {
    try {
        const coupon = await Coupon.findOne({
            code: req.params.code.toUpperCase(),
            isActive: true,
            expiresAt: { $gt: new Date() }
        });

        if (!coupon) {
            return res.status(404).json({ success: false, message: 'Invalid or expired coupon code' });
        }

        res.status(200).json({ success: true, data: coupon });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
