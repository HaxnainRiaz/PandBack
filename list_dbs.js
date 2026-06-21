const mongoose = require('mongoose');
require('dotenv').config({ path: '../StoreBackend/.env' });

async function listDatabases() {
    const uri = process.env.MONGODB_URI;
    try {
        const client = await mongoose.connect(uri);
        const admin = client.connection.db.admin();
        const dbs = await admin.listDatabases();
        console.log('Databases:', dbs.databases.map(db => db.name));
        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

listDatabases();
