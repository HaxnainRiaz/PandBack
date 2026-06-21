const Ticket = require('../models/Ticket');
const { createLog } = require('./auditController');

// @desc    Get all tickets
// @route   GET /api/tickets
// @access  Private/Admin
exports.getTickets = async (req, res) => {
    try {
        const tickets = await Ticket.find().populate('user', 'name email').sort('-createdAt');
        res.status(200).json({ success: true, count: tickets.length, data: tickets });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Update ticket status
// @route   PUT /api/tickets/:id
// @access  Private/Admin
exports.updateTicket = async (req, res) => {
    try {
        let ticket = await Ticket.findById(req.params.id);
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        ticket = await Ticket.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        // Audit Log
        if (req.body.status) {
            await createLog(req.user.id, 'Support Update', `Ticket #${ticket._id.toString().substring(18)} status set to ${req.body.status}`);
        }

        res.status(200).json({ success: true, data: ticket });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Add reply to ticket
// @route   POST /api/tickets/:id/reply
// @access  Private/Admin
exports.addReply = async (req, res) => {
    try {
        const ticket = await Ticket.findById(req.params.id);
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        const reply = {
            sender: 'admin',
            message: req.body.message
        };

        ticket.replies.push(reply);
        ticket.status = 'pending';
        await ticket.save();

        // Audit Log
        await createLog(req.user.id, 'Support Response', `Agent replied to Ticket #${ticket._id.toString().substring(18)}`);

        res.status(200).json({ success: true, data: ticket });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
