const mongoose = require('mongoose');
require('dotenv').config({ path: '../StoreBackend/.env' });

async function findProductDeletions() {
    const uri = process.env.MONGODB_URI;
    try {
        await mongoose.connect(uri);
        const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({}, { strict: false }));
        const logs = await AuditLog.find({ action: 'Product Deletion' });
        console.log(`Found ${logs.length} product deletions`);
        logs.forEach(l => console.log(`- ${l.details} at ${l.createdAt}`));
        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

findProductDeletions();
