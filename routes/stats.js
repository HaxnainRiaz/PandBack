const express = require('express');
const { getDashboardStats, getRevenueProgress } = require('../controllers/statsController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/dashboard', protect, authorize('admin'), getDashboardStats);
router.get('/progress', protect, authorize('admin'), getRevenueProgress);

module.exports = router;
