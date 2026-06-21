const socketUtil = require('../utils/socket');
const Blog = require('../models/Blog');
const { createLog } = require('./auditController');

// ... (keep getBlogs, getBlog, getBlogBySlug, and createBlog same but with socket)

// @desc    Get all blogs
// @route   GET /api/blogs
// @access  Public
exports.getBlogs = async (req, res) => {
    try {
        let isAdmin = false;
        if (req.headers.authorization?.startsWith('Bearer ')) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(req.headers.authorization.split(' ')[1], process.env.JWT_SECRET);
                isAdmin = decoded.role === 'admin';
            } catch (_) { /* public request */ }
        }

        const limit = req.query.limit
            ? Math.min(parseInt(req.query.limit), 100)
            : (isAdmin ? 200 : 50);
        const filter = isAdmin ? {} : { status: 'published' };
        const select = isAdmin
            ? undefined
            : 'title slug excerpt image author createdAt comments readTime category';

        let query = Blog.find(filter).sort({ createdAt: -1 }).limit(limit);
        if (select) query = query.select(select);
        const blogs = await query.lean();

        if (!isAdmin) {
            res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
        }
        res.status(200).json({ success: true, count: blogs.length, data: blogs });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get single blog
// @route   GET /api/blogs/:id
// @access  Public
exports.getBlog = async (req, res) => {
    try {
        const blog = await Blog.findById(req.params.id);
        if (!blog) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        res.status(200).json({ success: true, data: blog });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get single blog by slug
// @route   GET /api/blogs/slug/:slug
// @access  Public
exports.getBlogBySlug = async (req, res) => {
    try {
        const blog = await Blog.findOne({ slug: req.params.slug });
        if (!blog) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        res.status(200).json({ success: true, data: blog });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Create blog (Admin Only)
// @route   POST /api/blogs
// @access  Private/Admin
exports.createBlog = async (req, res) => {
    try {
        const blog = await Blog.create(req.body);

        // Audit Log
        if (req.user) {
            await createLog(req.user.id, 'Blog Creation', `Created blog: ${blog.title} (${blog.slug})`);
        }

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('blog:create', blog);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(201).json({ success: true, data: blog });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Update blog (Admin Only)
// @route   PUT /api/blogs/:id
// @access  Private/Admin
exports.updateBlog = async (req, res) => {
    try {
        let blog = await Blog.findById(req.params.id);
        if (!blog) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }

        blog = await Blog.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        // Audit Log
        if (req.user) {
            await createLog(req.user.id, 'Blog Update', `Updated blog: ${blog.title}`);
        }

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('blog:update', blog);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: blog });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Delete blog (Admin Only)
// @route   DELETE /api/blogs/:id
// @access  Private/Admin
exports.deleteBlog = async (req, res) => {
    try {
        const blog = await Blog.findById(req.params.id);
        if (!blog) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }

        const blogTitle = blog.title;
        await blog.deleteOne();

        // Audit Log
        if (req.user) {
            await createLog(req.user.id, 'Blog Deletion', `Deleted blog: ${blogTitle}`);
        }

        // Emit Socket Event
        try {
            socketUtil.getIO().emit('blog:delete', { id: req.params.id });
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Add comment to blog
// @route   POST /api/blogs/:id/comments
// @access  Public
exports.addComment = async (req, res) => {
    try {
        const { name, email, comment } = req.body;
        const blog = await Blog.findById(req.params.id);

        if (!blog) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }

        const newComment = {
            name,
            email,
            comment,
            createdAt: new Date()
        };

        blog.comments.unshift(newComment);
        await blog.save();

        res.status(201).json({ success: true, data: blog.comments[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
