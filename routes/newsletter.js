const express = require('express');
const { subscribe, getSubscribers, unsubscribe } = require('../controllers/newsletterController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
    .get(protect, authorize('admin'), getSubscribers)
    .post(subscribe);

router.route('/:id').delete(protect, authorize('admin'), unsubscribe);

module.exports = router;
