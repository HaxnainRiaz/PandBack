#!/usr/bin/env node
/**
 * MongoDB Connection Diagnostic Tool
 * Run this to test and diagnose connection issues
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const dns = require('dns').promises;
const dnsSync = require('dns');

// CRITICAL FIX: Force Google DNS to bypass local DNS issues
dnsSync.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

dotenv.config();

async function runDiagnostics() {
    console.log('🔍 MongoDB Connection Diagnostic Tool\n');
    console.log('═'.repeat(50));

    const uri = process.env.MONGODB_URI;
    
    if (!uri) {
        console.error('❌ ERROR: MONGODB_URI not set in .env file');
        process.exit(1);
    }

    const maskedUri = uri.replace(/:([^@]+)@/, ':****@');
    console.log(`📍 Testing URI: ${maskedUri}\n`);

    // Extract hostname
    const match = uri.match(/@([^/]+)/);
    const hostname = match ? match[1] : null;

    if (!hostname) {
        console.error('❌ Could not parse hostname from URI');
        process.exit(1);
    }

    console.log(`🌐 Hostname: ${hostname}`);

    // Step 1: Test DNS resolution
    console.log('\n[Step 1] Testing DNS Resolution...');
    try {
        const addresses = await dns.resolve4(hostname);
        console.log(`✅ DNS resolved to: ${addresses.join(', ')}`);
    } catch (err) {
        console.error(`❌ DNS Resolution Failed: ${err.message}`);
        console.log('💡 SOLUTIONS:');
        console.log('   1. Check your internet connection');
        console.log('   2. Try a different DNS (8.8.8.8)');
        console.log('   3. Check if firewall blocks MongoDB');
    }

    // Step 2: Test MongoDB Atlas IP Whitelist
    console.log('\n[Step 2] Testing MongoDB Connection...');
    const opts = {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        family: 4,
        authSource: 'admin',
        retryWrites: true,
    };

    try {
        console.log('⏳ Connecting... (this may take up to 30 seconds)');
        const conn = await mongoose.connect(uri, opts);
        console.log(`✅ MongoDB Connected Successfully!`);
        console.log(`   Host: ${conn.connection.host}`);
        console.log(`   Database: ${conn.connection.name}`);
        console.log(`   Ready State: ${conn.connection.readyState} (1=connected)`);
        
        await mongoose.disconnect();
        console.log('\n✅ All tests passed!');
        process.exit(0);
    } catch (err) {
        console.error(`❌ Connection Failed: ${err.message}`);
        
        if (err.message.includes('EBADRESP')) {
            console.log('\n💡 EBADRESP Error - DNS/Network Issue:');
            console.log('   ✓ Check MongoDB Atlas > Network Access');
            console.log('   ✓ Add your IP or 0.0.0.0/0 (for development)');
            console.log('   ✓ Verify you\'re not behind a firewall');
        } else if (err.message.includes('authentication failed')) {
            console.log('\n💡 Authentication Failed:');
            console.log('   ✓ Check username and password in .env');
            console.log('   ✓ Verify credentials haven\'t been changed');
            console.log('   ✓ Check authSource is set to "admin"');
        } else if (err.message.includes('connect ECONNREFUSED')) {
            console.log('\n💡 Connection Refused:');
            console.log('   ✓ MongoDB cluster may be paused/deleted');
            console.log('   ✓ Check MongoDB Atlas cluster status');
        }
        
        process.exit(1);
    }
}

runDiagnostics().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
