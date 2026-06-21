const socketUtil = require('../utils/socket');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const Category = require('../models/Category');
const { createLog } = require('./auditController');

// ... (keep getProducts and getProduct same)

// @desc    Get all products
// @route   GET /api/products
// @access  Public
const PRODUCT_LIST_FIELDS = 'title slug images price salePrice stock category isFeatured isBestSeller status rating totalReviews createdAt';

exports.getProducts = async (req, res) => {
    try {
        let isAdmin = false;
        if (req.headers.authorization?.startsWith('Bearer ')) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(req.headers.authorization.split(' ')[1], process.env.JWT_SECRET);
                isAdmin = decoded.role === 'admin';
            } catch (_) { /* public request */ }
        }

        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, isAdmin ? 500 : 200);
        const skip = (page - 1) * limit;

        const filter = isAdmin ? {} : { status: 'active' };
        const total = await Product.countDocuments(filter);
        const products = await Product.find(filter)
            .select(isAdmin ? undefined : PRODUCT_LIST_FIELDS)
            .populate('category', 'title slug')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        if (!isAdmin) {
            res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
        }
        res.status(200).json({
            success: true,
            total,
            data: products,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit),
                limit
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get single product by slug
// @route   GET /api/products/slug/:slug
// @access  Public
exports.getProductBySlug = async (req, res) => {
    try {
        const product = await Product.findOne({ slug: req.params.slug, status: 'active' })
            .populate('category', 'title slug')
            .lean();

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
        res.status(200).json({ success: true, data: product });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
exports.getProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        res.status(200).json({ success: true, data: product });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Create product (Admin Only)
// @route   POST /api/products
// @access  Private/Admin
exports.createProduct = async (req, res) => {
    try {
        // Transform Frontend Payload to Backend Schema
        console.log('Product payload received');

        // Map isBestseller (various casings)
        if (req.body.isBestseller !== undefined) req.body.isBestSeller = req.body.isBestseller;
        if (req.body.isBestSeller === undefined && req.body.isBestseller !== undefined) {
            req.body.isBestSeller = req.body.isBestseller;
        }

        if (req.body.seo) {
            req.body.metaTitle = req.body.seo.metaTitle || '';
            req.body.metaDescription = req.body.seo.metaDescription || '';
        }

        if (req.body.howToUse !== undefined) req.body.usage = req.body.howToUse;

        if (req.body.visibilityStatus) {
            req.body.status = req.body.visibilityStatus === 'published' ? 'active' : 'inactive';
        }

        // Map Category String or Object to ID
        // Map Category String or Object to ID
        if (req.body.category) {
            const cats = Array.isArray(req.body.category) ? req.body.category : [req.body.category];
            const validIds = [];

            for (const c of cats) {
                if (mongoose.Types.ObjectId.isValid(c)) {
                    validIds.push(c);
                } else if (typeof c === 'string') {
                    const categoryDoc = await Category.findOne({
                        title: { $regex: new RegExp(`^${c}$`, 'i') }
                    });
                    if (categoryDoc) validIds.push(categoryDoc._id);
                }
            }
            req.body.category = validIds;
        }

        console.log('Product payload processed');

        let product = await Product.create(req.body);
        product = await product.populate('category');

        // Audit Log
        await createLog(req.user.id, 'Product Creation', `Created product: ${product.title} (${product.slug})`);

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('product:create', product);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(201).json({ success: true, data: product });
    } catch (err) {
        console.error('Create Product Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Update product (Admin Only)
// @route   PUT /api/products/:id
// @access  Private/Admin
exports.updateProduct = async (req, res) => {
    try {
        // Transform Frontend Payload to Backend Schema
        console.log('Product update payload received');

        if (req.body.isBestseller !== undefined) req.body.isBestSeller = req.body.isBestseller;
        if (req.body.seo) {
            req.body.metaTitle = req.body.seo.metaTitle || '';
            req.body.metaDescription = req.body.seo.metaDescription || '';
        }
        if (req.body.howToUse !== undefined) req.body.usage = req.body.howToUse;
        if (req.body.visibilityStatus) {
            req.body.status = req.body.visibilityStatus === 'published' ? 'active' : 'inactive';
        }

        // Map Category String or Object to ID (Support Multiple)
        if (req.body.category) {
            const cats = Array.isArray(req.body.category) ? req.body.category : [req.body.category];
            const validIds = [];

            for (const c of cats) {
                if (mongoose.Types.ObjectId.isValid(c)) {
                    validIds.push(c);
                } else if (typeof c === 'string') {
                    const categoryDoc = await Category.findOne({
                        title: { $regex: new RegExp(`^${c}$`, 'i') }
                    });
                    if (categoryDoc) validIds.push(categoryDoc._id);
                }
            }
            req.body.category = validIds;
        }

        let product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        product = await Product.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        }).populate('category');

        // Audit Log
        await createLog(req.user.id, 'Product Update', `Updated product: ${product.title}`);

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('product:update', product);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: product });
    } catch (err) {
        console.error('Update Product Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Delete product (Admin Only)
// @route   DELETE /api/products/:id
// @access  Private/Admin
exports.deleteProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const productTitle = product.title;
        await product.deleteOne();

        // Audit Log
        await createLog(req.user.id, 'Product Deletion', `Deleted product: ${productTitle}`);

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('product:delete', { id: req.params.id });
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
