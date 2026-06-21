const express = require('express');
const router = express.Router();
const { getTickets, updateTicket, addReply } = require('../controllers/ticketController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);
router.use(authorize('admin'));

router.get('/', getTickets);
router.put('/:id', updateTicket);
router.post('/:id/reply', addReply);

module.exports = router;
