const express = require('express');
const blogController = require('../controllers/blogController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
    .get(blogController.getBlogs)
    .post(protect, authorize('admin'), blogController.createBlog);

router.route('/slug/:slug')
    .get(blogController.getBlogBySlug);

router.route('/:id')
    .get(blogController.getBlog)
    .put(protect, authorize('admin'), blogController.updateBlog)
    .delete(protect, authorize('admin'), blogController.deleteBlog);

router.post('/:id/comments', blogController.addComment);

module.exports = router;
