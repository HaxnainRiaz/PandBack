const express = require('express');
const orderController = require('../controllers/orderController');
const { protect, authorize, optional } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
    .post(optional, orderController.addOrderItems)
    .get(protect, authorize('admin'), orderController.getOrders);

router.route('/myorders').get(protect, orderController.getMyOrders);
router.route('/:id').get(protect, orderController.getOrderById);
router.route('/:id/pay').put(protect, orderController.updateOrderToPaid);
router.route('/:id/status').put(protect, authorize('admin'), orderController.updateOrderStatus);

// Bulk actions
router.post('/bulk-cancel', protect, authorize('admin'), orderController.bulkCancelOrders);
router.post('/bulk-update-payment', protect, authorize('admin'), orderController.bulkUpdatePaymentStatus);
router.patch('/:id', protect, authorize('admin'), orderController.updateOrderDetails);

module.exports = router;
