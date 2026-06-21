const express = require('express');
const { getBanners, createBanner, updateBanner, deleteBanner } = require('../controllers/bannerController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
    .get(getBanners)
    .post(protect, authorize('admin'), createBanner);

router.route('/:id')
    .put(protect, authorize('admin'), updateBanner)
    .delete(protect, authorize('admin'), deleteBanner);

module.exports = router;
