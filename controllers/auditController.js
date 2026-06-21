const AuditLog = require('../models/AuditLog');
require('../models/User'); // Ensure User model is registered for populate

// @desc    Get all audit logs
// @access  Private/Admin
exports.getAuditLogs = async (req, res) => {
    try {
        console.log('Fetching Audit Logs...');
        const logs = await AuditLog.find().populate('admin', 'name email').sort('-createdAt');
        console.log(`Found ${logs.length} logs.`);
        res.status(200).json({ success: true, count: logs.length, data: logs });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Create audit log (usually called internally)
exports.createLog = async (adminId, action, details) => {
    try {
        const log = await AuditLog.create({
            admin: adminId,
            action,
            details
        });
        console.log(`[AUDIT] Action: ${action} | Details: ${details}`);
    } catch (err) {
        console.error('Audit Log Error:', err.message);
    }
};
