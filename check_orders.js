const mongoose = require('mongoose');
require('dotenv').config({ path: '../StoreBackend/.env' });

async function checkOrders() {
    const uri = process.env.MONGODB_URI;
    try {
        await mongoose.connect(uri);
        const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }));
        const orders = await Order.find().limit(5);
        console.log(JSON.stringify(orders, null, 2));
        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

checkOrders();
