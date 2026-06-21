const mongoose = require('mongoose');
const dotenv = require('dotenv');
const crypto = require('crypto');
const path = require('path');

// Load env from parent dir if needed
dotenv.config();

const Order = require('./models/Order');

const fixOrderIds = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');

        const orders = await Order.find({});
        console.log(`Found ${orders.length} orders.`);

        let fixedCount = 0;

        for (const order of orders) {
            const currentNum = order.orderNumber;
            
            // Check if sequential or missing
            // Sequential looks like #00001 or similar (all digits after prefix)
            const isSequential = currentNum && currentNum.startsWith('#') && /^\d+$/.test(currentNum.substring(1));
            const isMissing = !currentNum;

            if (isSequential || isMissing) {
                console.log(`Fixing order ${order._id} (Current: ${currentNum || 'MISSING'})`);
                
                let unique = false;
                let newNum;
                while (!unique) {
                    newNum = `#${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
                    const exists = await Order.findOne({ orderNumber: newNum });
                    if (!exists) unique = true;
                }

                // Bypass immutable check if needed by using findByIdAndUpdate
                await Order.findByIdAndUpdate(order._id, { $set: { orderNumber: newNum } });
                fixedCount++;
            }
        }

        console.log(`Successfully fixed ${fixedCount} orders.`);
        process.exit(0);
    } catch (err) {
        console.error('Error during migration:', err);
        process.exit(1);
    }
};

fixOrderIds();
