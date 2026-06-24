require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Banner = require('../models/Banner');

async function run() {
    await connectDB();
    await Promise.all([
        Product.createIndexes(),
        Category.createIndexes(),
        Banner.collection.createIndex({ isActive: 1, createdAt: -1 })
    ]);
    console.log('Product, category, and banner indexes are present');
    await mongoose.disconnect();
}

run().catch((error) => {
    console.error('Index creation failed:', error.message);
    process.exitCode = 1;
});
