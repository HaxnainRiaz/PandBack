const express = require('express');
const { getTickets, getMyTickets, updateTicket, createTicket, addReply, deleteTicket } = require('../controllers/supportTicketController');
const { protect, authorize, optional } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
    .get(protect, authorize('admin'), getTickets)
    .post(optional, createTicket);

router.get('/my-tickets', protect, getMyTickets);

router.route('/:id')
    .put(protect, authorize('admin'), updateTicket)
    .delete(protect, authorize('admin'), deleteTicket);

router.post('/:id/reply', protect, addReply);

module.exports = router;

