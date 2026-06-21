const express = require('express');
const { getCms, updateCms } = require('../controllers/cmsController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', getCms);
router.put('/', protect, authorize('admin'), updateCms);

module.exports = router;
