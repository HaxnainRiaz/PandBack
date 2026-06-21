const express = require('express');
const { getReviews, updateReview, deleteReview, addReview, getProductReviews } = require('../controllers/reviewController');
const { protect, authorize, optional } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/product/:productId').get(getProductReviews);

router.route('/')
    .get(protect, authorize('admin'), getReviews)
    .post(optional, addReview);

router.route('/:id')
    .put(protect, authorize('admin'), updateReview)
    .delete(protect, authorize('admin'), deleteReview);

module.exports = router;
