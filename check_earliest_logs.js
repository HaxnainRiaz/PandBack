const mongoose = require('mongoose');
require('dotenv').config({ path: '../StoreBackend/.env' });

async function checkEarliestAuditLogs() {
    const uri = process.env.MONGODB_URI;
    try {
        await mongoose.connect(uri);
        const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({}, { strict: false }));
        const logs = await AuditLog.find().sort({ createdAt: 1 }).limit(20);
        console.log(JSON.stringify(logs, null, 2));
        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

checkEarliestAuditLogs();
