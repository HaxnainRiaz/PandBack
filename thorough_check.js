const mongoose = require('mongoose');
require('dotenv').config({ path: '../StoreBackend/.env' });

async function thoroughCollectionCheck() {
    const uri = process.env.MONGODB_URI;
    try {
        await mongoose.connect(uri);
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log('Found Collections:');
        for (const col of collections) {
            const count = await mongoose.connection.db.collection(col.name).countDocuments();
            console.log(`- ${col.name}: ${count} docs`);
            if (count > 0 && (col.name.includes('prod') || col.name.includes('item') || col.name.includes('skincare'))) {
                const sample = await mongoose.connection.db.collection(col.name).findOne();
                console.log(`  Sample keys: ${Object.keys(sample).join(', ')}`);
            }
        }
        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

thoroughCollectionCheck();
