const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');
const readline = require('readline');

// Determine environment
const envPath = process.argv.includes('--prod') ? '.env.production' : '.env';
dotenv.config({ path: envPath });

console.log(`Using environment: ${envPath}`);

// Setup Readline Interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => {
    return new Promise(resolve => rl.question(query, resolve));
};

const deleteUser = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.\n');

        console.log('--- DELETE USER ACCOUNT ---');

        const email = await askQuestion('Enter Email of the user to delete: ');

        if (!email) {
            console.log('Email is required.');
            process.exit(0);
        }

        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
            console.log(`\n❌ User not found with email: ${email}`);
            process.exit(0);
        }

        console.log(`\n⚠️  WARNING: You are about to delete the following user:`);
        console.log(`Name: ${user.name}`);
        console.log(`Email: ${user.email}`);
        console.log(`Role: ${user.role}`);
        console.log(`ID: ${user._id}`);
        console.log('This action CANNOT be undone.\n');

        const confirm = await askQuestion('Type "DELETE" to confirm: ');

        if (confirm === 'DELETE') {
            await User.findByIdAndDelete(user._id);
            console.log(`\n✅ User ${email} has been permanently deleted.`);
        } else {
            console.log('\n❌ Action Cancelled. User was not deleted.');
        }

        rl.close();
        process.exit(0);

    } catch (err) {
        console.error('Error:', err.message);
        rl.close();
        process.exit(1);
    }
};

deleteUser();
