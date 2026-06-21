const express = require('express');
const { getSEO, updateSEO } = require('../controllers/seoController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
    .get(getSEO)
    .post(protect, authorize('admin'), updateSEO);

module.exports = router;
