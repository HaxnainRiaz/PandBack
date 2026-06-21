const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const fixIndices = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const collection = mongoose.connection.collection('reviews');

        // Drop the problematic unique index
        try {
            await collection.dropIndex('product_1_user_1');
            console.log('✅ Dropped unique index product_1_user_1');
        } catch (e) {
            console.log('Index product_1_user_1 not found or already dropped');
        }

        // Add a non-unique index for performance
        await collection.createIndex({ product: 1 });
        console.log('✅ Created non-unique index for product');

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

fixIndices();
