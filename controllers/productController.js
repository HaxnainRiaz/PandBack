const socketUtil = require('../utils/socket');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const Category = require('../models/Category');
const { createLog } = require('./auditController');
const { getCache, setCache, invalidateCache } = require('../utils/cache');

// ... (keep getProducts and getProduct same)

// @desc    Get all products
// @route   GET /api/products
// @access  Public
const PRODUCT_LIST_FIELDS = 'title slug images price salePrice stock category isFeatured isBestSeller status rating totalReviews createdAt';

exports.getProducts = async (req, res, next) => {
    try {
        let isAdmin = false;
        if (req.headers.authorization?.startsWith('Bearer ')) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(req.headers.authorization.split(' ')[1], process.env.JWT_SECRET);
                isAdmin = decoded.role === 'admin';
            } catch (_) { /* public request */ }
        }

        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const defaultLimit = isAdmin ? 100 : 20;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || defaultLimit, 1), isAdmin ? 500 : 50);
        const skip = (page - 1) * limit;

        const filter = isAdmin ? {} : { status: 'active' };
        if (req.query.featured === 'true') filter.isFeatured = true;
        if (req.query.bestseller === 'true') filter.isBestSeller = true;
        if (req.query.category && mongoose.Types.ObjectId.isValid(req.query.category)) {
            filter.category = req.query.category;
        }
        if (req.query.search?.trim()) filter.$text = { $search: req.query.search.trim() };

        const cacheKey = `products:list:${JSON.stringify({ page, limit, ...req.query })}`;
        if (!isAdmin) {
            const cached = getCache(cacheKey);
            res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
            if (cached) return res.status(200).json(cached);
        }

        const query = Product.find(filter)
            .select(isAdmin ? undefined : PRODUCT_LIST_FIELDS)
            .populate('category', 'title slug')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .maxTimeMS(2500)
            .lean();
        const [total, products] = await Promise.all([
            Product.countDocuments(filter).maxTimeMS(2500),
            query
        ]);

        const payload = {
            success: true,
            total,
            data: products,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit),
                limit
            }
        };
        if (!isAdmin) setCache(cacheKey, payload, 60);
        return res.status(200).json(payload);
    } catch (err) {
        return next(err);
    }
};

// @desc    Get single product by slug
// @route   GET /api/products/slug/:slug
// @access  Public
exports.getProductBySlug = async (req, res, next) => {
    try {
        const cacheKey = `products:slug:${req.params.slug}`;
        const cached = getCache(cacheKey);
        res.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
        if (cached) return res.status(200).json(cached);

        const product = await Product.findOne({ slug: req.params.slug, status: 'active' })
            .select('-__v')
            .populate('category', 'title slug')
            .maxTimeMS(2000)
            .lean();

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const payload = { success: true, data: product };
        setCache(cacheKey, payload, 120);
        return res.status(200).json(payload);
    } catch (err) {
        return next(err);
    }
};

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
exports.getProduct = async (req, res, next) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid product id' });
        }
        const product = await Product.findOne({ _id: req.params.id, status: 'active' })
            .select('-__v').maxTimeMS(2000).lean();
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        res.status(200).json({ success: true, data: product });
    } catch (err) {
        return next(err);
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
        invalidateCache('products:');
        invalidateCache('store:');

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
        invalidateCache('products:');
        invalidateCache('store:');

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
        invalidateCache('products:');
        invalidateCache('store:');

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
