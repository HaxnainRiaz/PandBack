const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Review = require('./models/Review');

dotenv.config();

const checkIndices = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const indexes = await mongoose.connection.collection('reviews').indexes();
        console.log('Reviews Indices:', JSON.stringify(indexes, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

checkIndices();
