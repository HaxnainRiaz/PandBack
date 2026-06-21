require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Order = require('./models/Order');
const Review = require('./models/Review');
const SupportTicket = require('./models/SupportTicket');
const Ticket = require('./models/Ticket'); // Seems duplicate but checking just in case
const AuditLog = require('./models/AuditLog');
const Newsletter = require('./models/Newsletter');
const Product = require('./models/Product');

const resetForProduction = async () => {
    try {
        console.log('🔌 Connecting to Database...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to Database');

        console.log('\n🧹 STARTING PRODUCTION RESET...');
        console.log('This will delete all transactional data (Orders, Reviews, Tickets, Logs, Customers).');
        console.log('It will PRESERVE your Store Catalog (Products, Categories, CMS) and Admin Accounts.\n');

        // 1. Clear Orders
        console.log('🗑️  Deleting Orders...');
        const orders = await Order.deleteMany({});
        console.log(`   Deleted ${orders.deletedCount} orders.`);

        // 2. Clear Reviews
        console.log('🗑️  Deleting Reviews...');
        const reviews = await Review.deleteMany({});
        console.log(`   Deleted ${reviews.deletedCount} reviews.`);

        // 3. Clear Support Tickets
        console.log('🗑️  Deleting Support Tickets...');
        const supportTickets = await SupportTicket.deleteMany({});
        console.log(`   Deleted ${supportTickets.deletedCount} support tickets.`);

        // Check for duplicate Ticket model usage if applicable
        try {
            const tickets = await Ticket.deleteMany({});
            if (tickets.deletedCount > 0) console.log(`   Deleted ${tickets.deletedCount} legacy tickets.`);
        } catch (e) { }

        // 4. Clear Audit Logs
        console.log('🗑️  Deleting Audit Logs...');
        const logs = await AuditLog.deleteMany({});
        console.log(`   Deleted ${logs.deletedCount} audit logs.`);

        // 5. Clear Newsletter Subscriptions
        console.log('🗑️  Deleting Newsletter Subscriptions...');
        const newsletter = await Newsletter.deleteMany({});
        console.log(`   Deleted ${newsletter.deletedCount} newsletter emails.`);

        // 6. Delete Non-Admin Users
        console.log('🗑️  Deleting Customer Accounts...');
        const users = await User.deleteMany({ role: { $ne: 'admin' } });
        console.log(`   Deleted ${users.deletedCount} customer accounts.`);

        // 7. Reset Product Metrics (Rating, NumReviews, Sold)
        console.log('🔄 Resetting Product Metrics (sales/ratings)...');
        // Reset sold count, ratings to clean state since orders/reviews are gone
        const productsUpdate = await Product.updateMany({}, {
            $set: {
                rating: 0,
                numReviews: 0,
                sold: 0
            }
        });
        console.log(`   Reset metrics for ${productsUpdate.modifiedCount} products.`);

        console.log('\n✨ PRODUCTION RESET COMPLETE! ✨');
        console.log('Your admin account, products, categories, and settings are safe.');
        console.log('You are ready to accept real customers.');

        process.exit();
    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        process.exit(1);
    }
};

resetForProduction();
