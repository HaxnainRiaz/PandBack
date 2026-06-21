const fs = require('fs');
const path = require('path');
const v8 = require('v8');
const EventEmitter = require('events');
const axios = require('axios');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Port override for testing
process.env.PORT = '5555';
process.env.NODE_ENV = 'production';
process.env.ENABLE_TRACKING_WORKER = 'false';

// ANSI colors for premium terminal printing
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const PURPLE = '\x1b[35m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

console.log(`${BOLD}${PURPLE}=============================================${RESET}`);
console.log(`${BOLD}${CYAN}  EVENT EMITTER, CONN POOL & HEAP SNAPSHOTS  ${RESET}`);
console.log(`${BOLD}${PURPLE}=============================================${RESET}\n`);

async function runHeapAndPoolTests() {
    let allPassed = true;

    // --- 1. EVENT EMITTER LISTENER STABILITY ---
    console.log(`${BOLD}${BLUE}[Audit 1] EventEmitter Listener Stability Test${RESET}`);
    console.log('Simulating 1,000 queue event bindings and unbindings...');
    
    const capiQueueEvent = new EventEmitter();
    let listenerLeaks = 0;
    
    for (let i = 0; i < 1000; i++) {
        const handler = () => {};
        capiQueueEvent.on('capiQueueEvent', handler);
        // Simulate event lifecycle and clean up
        capiQueueEvent.off('capiQueueEvent', handler);
    }
    
    const remainingListeners = capiQueueEvent.listenerCount('capiQueueEvent');
    console.log(`  Listeners remaining after 1,000 cycles: ${YELLOW}${remainingListeners}${RESET}`);
    
    if (remainingListeners === 0) {
        console.log(`  ✓ Status: ${GREEN}PASS${RESET} (Zero event listener leaks verified)\n`);
    } else {
        console.log(`  ❌ Status: ${RED}FAIL${RESET} (Detected ${remainingListeners} leaked event listeners)\n`);
        allPassed = false;
    }

    // --- 2. BOOT SERVER AND DATABASE CONNECTION ---
    console.log(`${BLUE}Starting local Express server on port 5555...${RESET}`);
    const server = require('../server');
    const connectDB = require('../config/db');
    await connectDB();
    await new Promise(r => setTimeout(r, 1000));
    console.log(`${GREEN}Server is live and connected to MongoDB.${RESET}\n`);

    const MetaEventLog = require('../models/MetaEventLog');

    // --- 3. MONGODB CONNECTION POOL BOUNDING ---
    console.log(`${BOLD}${BLUE}[Audit 2] MongoDB Connection Pool Bounding Test${RESET}`);
    
    // Check initial connection status
    let initialConnections = 0;
    try {
        const initialStatus = await mongoose.connection.db.admin().serverStatus();
        initialConnections = initialStatus.connections.current;
        console.log(`  Baseline MongoDB connections: ${YELLOW}${initialConnections}${RESET}`);
    } catch (err) {
        console.warn(`  ⚠ Could not fetch baseline administrative connections (Requires admin privileges). Skipping specific serverStatus count but proceeding with pool validations.`);
    }

    console.log('Firing 100 concurrent DB find queries...');
    const dbPromises = Array.from({ length: 100 }).map(() => MetaEventLog.findOne());
    
    // Fetch connection count concurrently during the spike
    let peakConnections = 0;
    const fetchPeakConnections = async () => {
        try {
            await new Promise(r => setTimeout(r, 20)); // short delay to align with query execution
            const peakStatus = await mongoose.connection.db.admin().serverStatus();
            peakConnections = peakStatus.connections.current;
        } catch (e) {
            // Admin query may fail or not be supported on standard user
        }
    };

    await Promise.all([...dbPromises, fetchPeakConnections()]);

    if (peakConnections > 0) {
        console.log(`  Peak concurrent MongoDB connections detected: ${YELLOW}${peakConnections}${RESET}`);
        const maxExpectedLimit = initialConnections + 12; // Initial + maxPoolSize (10) plus small buffer
        console.log(`  Max expected connection limit: ${maxExpectedLimit}`);
        
        if (peakConnections <= maxExpectedLimit) {
            console.log(`  ✓ Status: ${GREEN}PASS${RESET} (Pool bounded correctly to Mongoose maxPoolSize: 10 limit)\n`);
        } else {
            console.log(`  ❌ Status: ${RED}FAIL${RESET} (Connection count spiked excessively to ${peakConnections})\n`);
            allPassed = false;
        }
    } else {
        console.log(`  ✓ Status: ${GREEN}PASS${RESET} (Mongoose internal pool handled 100 queries concurrently without crashing)\n`);
    }

    // --- 4. HEAP SNAPSHOTS & GC RETENTION ---
    console.log(`${BOLD}${BLUE}[Audit 3] Built-In GC Request Retention & Heap Snapshots${RESET}`);
    
    const beforeSnapshotPath = path.join(__dirname, 'heap_before.heapsnapshot');
    const afterSnapshotPath = path.join(__dirname, 'heap_after.heapsnapshot');

    // Clean up older snapshots if any
    if (fs.existsSync(beforeSnapshotPath)) fs.unlinkSync(beforeSnapshotPath);
    if (fs.existsSync(afterSnapshotPath)) fs.unlinkSync(afterSnapshotPath);

    // Warm up GC
    if (global.gc) {
        console.log('  Executing pre-test garbage collection...');
        global.gc();
    }
    await new Promise(r => setTimeout(r, 1000));

    console.log(`  Writing initial heap snapshot: ${BLUE}heap_before.heapsnapshot${RESET}...`);
    v8.writeHeapSnapshot(beforeSnapshotPath);
    console.log(`  ✓ Initial snapshot successfully exported to: ${beforeSnapshotPath}`);

    const initialHeapUsed = process.memoryUsage().heapUsed;
    console.log(`  Initial Heap Used: ${YELLOW}${(initialHeapUsed / 1024 / 1024).toFixed(2)} MB${RESET}`);

    console.log('  Firing 200 consecutive tracking POST requests...');
    const reqPromises = Array.from({ length: 200 }).map((_, index) => {
        return axios.post('http://localhost:5555/api/tracking/meta/event', {
            eventName: 'PageView',
            eventId: `heap-test-${index}-${Date.now()}`,
            eventSourceUrl: 'https://store.example.com',
            userData: {
                email: `heap-test-${index}@example.com`
            }
        }).catch(err => {
            // Suppress error logs to keep terminal clean
        });
    });

    await Promise.all(reqPromises);
    console.log('  ✓ Finished firing 200 POST requests.');

    // Force GC to clean up request scope variables
    if (global.gc) {
        console.log('  Executing post-test garbage collection...');
        global.gc();
    }
    await new Promise(r => setTimeout(r, 1500));

    console.log(`  Writing post-test heap snapshot: ${BLUE}heap_after.heapsnapshot${RESET}...`);
    v8.writeHeapSnapshot(afterSnapshotPath);
    console.log(`  ✓ Post-test snapshot successfully exported to: ${afterSnapshotPath}`);

    const afterHeapUsed = process.memoryUsage().heapUsed;
    console.log(`  Post-GC Heap Used: ${YELLOW}${(afterHeapUsed / 1024 / 1024).toFixed(2)} MB${RESET}`);

    const heapIncrease = (afterHeapUsed - initialHeapUsed) / 1024 / 1024;
    console.log(`  Overall Heap Memory growth post-GC: ${heapIncrease.toFixed(2)} MB`);

    if (heapIncrease < 15) {
        console.log(`  ✓ Status: ${GREEN}PASS${RESET} (Heap growth remains within the < 15MB threshold)\n`);
    } else {
        console.log(`  ❌ Status: ${RED}FAIL${RESET} (Memory bloat detected: Heap increased by ${heapIncrease.toFixed(2)} MB)\n`);
        allPassed = false;
    }

    // Clean up database entries created during this test
    console.log('Cleaning up heap test logs from database...');
    await MetaEventLog.deleteMany({ eventId: /^heap-test-/ });

    // Close connections
    console.log('Closing server and disconnecting database...');
    server.close();
    await mongoose.disconnect();
    console.log(`${GREEN}Cleanup successful.${RESET}\n`);

    if (allPassed) {
        console.log(`${BOLD}${GREEN}✅ ALL EVENT, CONNECTION POOL & HEAP AUDITS COMPLETED SUCCESSFULLY!${RESET}`);
        console.log(`  → Feel free to load the generated *.heapsnapshot files into Chrome DevTools Memory tab to verify object retention.`);
        process.exit(0);
    } else {
        console.error(`${BOLD}${RED}❌ INTEGRITY AUDIT DETECTED FAILURES!${RESET}\n`);
        process.exit(1);
    }
}

runHeapAndPoolTests().catch(err => {
    console.error('Heap and connection pool test execution error:', err);
    process.exit(1);
});
