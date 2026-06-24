const Category = require('../models/Category');
const { createLog } = require('./auditController');
const socketUtil = require('../utils/socket');
const { invalidateCache } = require('../utils/cache');

// @desc    Get all categories
// @route   GET /api/categories
// @access  Public
exports.getCategories = async (req, res) => {
    try {
        const categories = await Category.find().select('title slug image description').sort({ title: 1 }).lean();
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
        res.status(200).json({ success: true, data: categories });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Create category
// @route   POST /api/categories
// @access  Private/Admin
exports.createCategory = async (req, res) => {
    try {
        const category = await Category.create(req.body);
        invalidateCache('store:');

        // Audit Log
        await createLog(req.user.id, 'Category Creation', `Created category: ${category.title}`);

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('category:update', category);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(201).json({ success: true, data: category });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private/Admin
exports.updateCategory = async (req, res) => {
    try {
        const category = await Category.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });
        if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
        invalidateCache('store:');

        // Audit Log
        await createLog(req.user.id, 'Category Update', `Updated category: ${category.title}`);

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('category:update', category);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: category });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
exports.deleteCategory = async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (category) {
            const categoryTitle = category.title;
            await Category.findByIdAndDelete(req.params.id);
            invalidateCache('store:');

            // Audit Log
            await createLog(req.user.id, 'Category Deletion', `Deleted category: ${categoryTitle}`);

            // Emit Socket Event
            try {
                socketUtil.getIO().emit('category:update', { id: req.params.id, delete: true });
            } catch (e) { console.error('Socket Emit Error:', e); }
        }
        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
