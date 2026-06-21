const mongoose = require('mongoose');
require('dotenv').config({ path: '../StoreBackend/.env' });

async function checkSpecificProduct() {
    const uri = process.env.MONGODB_URI;
    try {
        await mongoose.connect(uri);
        const Product = mongoose.model('Product', new mongoose.Schema({}, { strict: false }));
        const prod = await Product.findById('6977c58ffc572be04008c316');
        console.log('Product Found:', !!prod);
        if (prod) console.log(JSON.stringify(prod, null, 2));
        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

checkSpecificProduct();
