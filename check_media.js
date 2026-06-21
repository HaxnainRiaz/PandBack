const mongoose = require('mongoose');
require('dotenv').config({ path: '../StoreBackend/.env' });

async function checkMedia() {
    const uri = process.env.MONGODB_URI;
    try {
        await mongoose.connect(uri);
        const Media = mongoose.model('Media', new mongoose.Schema({}, { strict: false }));
        const items = await Media.find().limit(20);
        console.log(JSON.stringify(items, null, 2));
        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

checkMedia();
