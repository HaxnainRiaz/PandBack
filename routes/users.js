const express = require('express');
const {
    getUsers,
    getStaff,
    updateUser,
    addToWishlist,
    removeFromWishlist,
    addAddress,
    deleteAddress,
    getMyOrders,
    updateProfile,
    deleteUser
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// Admin Routes
router.get('/', protect, authorize('admin'), getUsers);
router.get('/staff', protect, authorize('admin'), getStaff);
router.put('/:id', protect, authorize('admin'), updateUser);
router.delete('/:id', protect, authorize('admin'), deleteUser);

// Customer Routes
router.get('/my-orders', protect, getMyOrders);
router.post('/wishlist/:productId', protect, addToWishlist);
router.delete('/wishlist/:productId', protect, removeFromWishlist);
router.post('/addresses', protect, addAddress);
router.delete('/addresses/:addressId', protect, deleteAddress);
router.put('/profile', protect, updateProfile);

module.exports = router;
