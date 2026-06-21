const mongoose = require('mongoose');
require('dotenv').config({ path: '../StoreBackend/.env' });

async function checkTestDb() {
    const uri = process.env.MONGODB_URI.replace('skincare_db', 'test');
    try {
        await mongoose.connect(uri);
        console.log('Connected to:', mongoose.connection.name);
        const collections = await mongoose.connection.db.listCollections().toArray();
        for (const col of collections) {
            const count = await mongoose.connection.db.collection(col.name).countDocuments();
            console.log(`- ${col.name}: ${count}`);
        }
        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

checkTestDb();
