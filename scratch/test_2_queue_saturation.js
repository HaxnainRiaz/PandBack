const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

const connectDB = require('../config/db');
const MetaEventLog = require('../models/MetaEventLog');

async function runQueueSaturationTest() {
    console.log('\n=============================================');
    console.log('    QUEUE BACKLOG SATURATION MEMORY TEST     ');
    console.log('=============================================');
    
    // Connect to database
    await connectDB();
    
    // Warm up the heap and let garbage collection stabilize if possible
    if (global.gc) global.gc();
    await new Promise(r => setTimeout(r, 1000));
    
    const beforeMem = process.memoryUsage();
    console.log(`Memory before insert: RSS ${(beforeMem.rss/1024/1024).toFixed(2)} MB, Heap ${(beforeMem.heapUsed/1024/1024).toFixed(2)} MB`);
    
    console.log('Inserting 500 queued events into DB backlog...');
    const events = [];
    const now = Date.now();
    for (let i = 0; i < 500; i++) {
        events.push({
            eventName: 'AddToCart',
            eventId: `saturation-test-${i}-${now}`,
            source: 'server',
            status: 'queued',
            attempts: 0,
            maxAttempts: 3,
            createdAt: new Date(),
            deduplicationKey: `AddToCart_saturation-test-${i}-${now}_server`,
            requestPayloadSafe: {
                event_name: 'AddToCart',
                event_time: Math.floor(Date.now() / 1000),
                event_id: `saturation-test-${i}-${now}`,
                user_data: { em: ['f3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'] }
            }
        });
    }
    
    await MetaEventLog.insertMany(events, { ordered: false });
    
    if (global.gc) global.gc();
    await new Promise(r => setTimeout(r, 1000));
    
    const afterInsertMem = process.memoryUsage();
    const heapIncrease = (afterInsertMem.heapUsed - beforeMem.heapUsed) / 1024 / 1024;
    console.log(`Memory after 500 inserts: RSS ${(afterInsertMem.rss/1024/1024).toFixed(2)} MB, Heap ${(afterInsertMem.heapUsed/1024/1024).toFixed(2)} MB`);
    console.log(`Heap increase: ${heapIncrease.toFixed(2)} MB`);
    
    const queuedCount = await MetaEventLog.countDocuments({
        status: 'queued',
        eventName: 'AddToCart',
        eventId: /^saturation-test-/
    });
    
    console.log(`Events stored in DB (not RAM): ${queuedCount}`);
    
    let isPassed = true;
    if (heapIncrease > 30) {
        console.error(`❌ FAIL: Heap increased by ${heapIncrease.toFixed(2)} MB (> 30 MB threshold) — possible queue buffering in RAM.`);
        isPassed = false;
    } else {
        console.log(`✅ PASS: Heap increase of ${heapIncrease.toFixed(2)} MB is acceptable.`);
    }
    
    if (queuedCount >= 490) {
        console.log(`✅ PASS: ${queuedCount}/500 events safely persisted to DB.`);
    } else {
        console.error(`❌ FAIL: Only ${queuedCount}/500 events found in DB — potential data loss.`);
        isPassed = false;
    }
    
    // Clean up
    console.log('Cleaning up saturation test events...');
    await MetaEventLog.deleteMany({ eventId: /^saturation-test-/ });
    console.log('Cleanup completed.');
    
    await mongoose.disconnect();
    
    if (isPassed) {
        process.exit(0);
    } else {
        process.exit(1);
    }
}

runQueueSaturationTest().catch(err => {
    console.error('Queue saturation test error:', err);
    process.exit(1);
});
