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
console.log(`${BOLD}${CYAN}     BODY-PARSER LIMITS & MEMORY SAFETY      ${RESET}`);
console.log(`${BOLD}${PURPLE}=============================================${RESET}\n`);

async function runBodyParserTest() {
    // 1. Start local server
    console.log(`${BLUE}Starting local Express server on port 5555...${RESET}`);
    const server = require('../server');
    const connectDB = require('../config/db');
    await connectDB();
    await new Promise(r => setTimeout(r, 1000));
    console.log(`${GREEN}Server is live and database is connected.${RESET}\n`);

    if (global.gc) global.gc();
    await new Promise(r => setTimeout(r, 1000));

    const initialHeap = process.memoryUsage().heapUsed;
    console.log(`Initial Heap Memory: ${YELLOW}${(initialHeap / 1024 / 1024).toFixed(2)} MB${RESET}`);

    // 2. Generate ~3MB payload
    console.log(`${BLUE}Generating ~3MB oversized request payload...${RESET}`);
    const largeString = 'x'.repeat(3 * 1024 * 1024); // 3MB
    
    let isPassed = false;
    
    try {
        console.log(`${BLUE}Posting 3MB payload to /api/tracking/meta/event...${RESET}`);
        await axios.post('http://localhost:5555/api/tracking/meta/event', {
            eventName: 'PageView',
            eventId: 'oversized-event-' + Date.now(),
            eventSourceUrl: 'https://store.example.com',
            userData: {
                email: 'test@example.com'
            },
            customData: {
                payload: largeString
            }
        }, {
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.error(`  ${RED}❌ FAIL: The server accepted a 3MB payload! Express limits were not enforced.${RESET}`);
    } catch (error) {
        if (global.gc) {
            console.log('Running garbage collection before taking post-test heap measurement...');
            global.gc();
        }
        await new Promise(r => setTimeout(r, 1000));
        
        const afterHeap = process.memoryUsage().heapUsed;
        console.log(`Heap Memory after request: ${YELLOW}${(afterHeap / 1024 / 1024).toFixed(2)} MB${RESET}`);
        
        const heapDiff = (afterHeap - initialHeap) / 1024 / 1024;
        console.log(`Heap memory change: ${heapDiff.toFixed(2)} MB`);

        const response = error.response;
        if (response) {
            console.log(`  ✓ Response Status Code: ${GREEN}${response.status}${RESET} (${response.statusText})`);
            
            // Check status code and heap threshold
            if (response.status === 413) {
                console.log(`  ✓ Status code assertion: ${GREEN}PASS${RESET} (Correctly rejected with 413 Payload Too Large)`);
                
                if (heapDiff < 15) {
                    console.log(`  ✓ Memory overhead assertion: ${GREEN}PASS${RESET} (Heap increase ${heapDiff.toFixed(2)} MB is below 15 MB limit)`);
                    isPassed = true;
                } else {
                    console.error(`  ${RED}❌ FAIL: Heap increase is too high (${heapDiff.toFixed(2)} MB >= 15 MB threshold)! Potential memory bloating.${RESET}`);
                }
            } else {
                console.error(`  ${RED}❌ FAIL: Response status code is ${response.status} instead of expected 413 Payload Too Large!${RESET}`);
            }
        } else {
            console.error(`  ${RED}❌ FAIL: Connection errored without server response: ${error.message}${RESET}`);
        }
    }

    // 3. Clean up
    console.log('\nClosing server and disconnecting database...');
    server.close();
    await mongoose.disconnect();
    console.log(`${GREEN}Cleanup successful.${RESET}\n`);

    if (isPassed) {
        console.log(`${BOLD}${GREEN}✅ BODY-PARSER AND MEMORY SAFETY TEST PASSED SUCCESSFULLY!${RESET}\n`);
        process.exit(0);
    } else {
        console.error(`${BOLD}${RED}❌ BODY-PARSER AND MEMORY SAFETY TEST FAILED!${RESET}\n`);
        process.exit(1);
    }
}

runBodyParserTest().catch(err => {
    console.error('Body-parser test run error:', err);
    process.exit(1);
});
