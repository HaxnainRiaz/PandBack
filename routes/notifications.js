const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const router = express.Router();

let clients = [];

// SSE Stream Endpoint
router.get('/stream', protect, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const userId = req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    const newClient = {
        id: userId,
        res,
        isAdmin
    };

    clients.push(newClient);

    // Send initial connection success event
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'SSE Connection Established' })}\n\n`);

    // Remove client on close
    req.on('close', () => {
        clients = clients.filter(c => c.res !== res);
    });
});

// Function to send notifications
const sendNotification = (userId, type, payload) => {
    clients.forEach(client => {
        // Send to specific user OR to all admins (if it's an admin notification)
        if (client.id === userId || (client.isAdmin && type.startsWith('ADMIN_'))) {
            client.res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
        }
    });
};

module.exports = { router, sendNotification };
