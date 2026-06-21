const axios = require('axios');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const connectDB = require('../config/db');

async function runTests() {
    await connectDB();
    console.log("=======================================");
    console.log("   DB Disconnect Resilience Tests      ");
    console.log("=======================================\n");

    const PORT = process.env.PORT || 5000;
    const API_URL = `http://localhost:${PORT}/api`;

    let loginData;
    let testsPassed = 0;
    let totalTests = 5;

    // Wait for server to start if we just started it
    await new Promise(resolve => setTimeout(resolve, 2000));

    // TEST 1: Check if DB connection is active and valid (baseline)
    console.log("Test 1: Verify DB Connection is Active");
    if (mongoose.connection.readyState === 1) {
        console.log("✅ Passed: Mongoose is connected.");
        testsPassed++;
    } else {
        console.log("❌ Failed: Mongoose is not connected (State: " + mongoose.connection.readyState + ").");
        // We can't proceed with auth tests if we don't have a DB at all to login
        console.log("\nAborting remaining tests as baseline DB connection failed.");
        return;
    }

    // Attempt Login
    try {
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            email: 'admin@luminelle.com',
            password: 'password123'
        }, { validateStatus: false });

        if (loginRes.status === 200) {
            loginData = loginRes.data;
        } else {
            console.log("Could not login as admin@luminelle.com. Proceeding with tests that don't require valid auth first.");
        }
    } catch (e) {
        console.log("Could not reach auth login:", e.message);
    }

    // TEST 2: Test Unauthenticated Request returns 401
    console.log("\nTest 2: Verify Unauthenticated Request Returns 401");
    try {
        const { protect } = require('../middleware/authMiddleware');
        let statusCode = null;
        let responseJson = null;
        
        const req = { headers: {} };
        const res = {
            status: function(code) {
                statusCode = code;
                return this;
            },
            json: function(data) {
                responseJson = data;
                return this;
            }
        };
        const next = () => {};

        await protect(req, res, next);
        
        if (statusCode === 401 && responseJson.message === 'No token provided') {
            console.log("✅ Passed: Returned 401 Unauthorized correctly.");
            testsPassed++;
        } else {
            console.log(`❌ Failed: Returned ${statusCode} instead of 401. Message: ${responseJson?.message}`);
        }
    } catch (e) {
        console.log("❌ Failed:", e.message);
    }

    // TEST 3: Mock DB Disconnect and check Meta Queue Worker aborts
    console.log("\nTest 3: Verify Meta Queue Worker Aborts When DB Disconnected");
    const originalReadyState = mongoose.connection.readyState;
    
    // Force mock ready state to disconnected (0)
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, writable: true });

    try {
        const { processPendingQueue } = require('../services/metaQueueService');
        const result = await processPendingQueue(5);
        if (result.status === 'db_unavailable' && result.processed === 0) {
            console.log("✅ Passed: Queue worker aborted cleanly with status 'db_unavailable'.");
            testsPassed++;
        } else {
            console.log(`❌ Failed: Queue worker did not abort as expected. Status: ${result.status}`);
        }
    } catch (e) {
        console.log("❌ Failed:", e.message);
    }

    // TEST 4: Mock DB Disconnect and verify auth middleware returns 503
    console.log("\nTest 4: Verify Auth Middleware Returns 503 When DB Disconnected");
    try {
        const { protect } = require('../middleware/authMiddleware');
        
        let statusCode = null;
        let responseJson = null;
        
        const req = {
            headers: { authorization: 'Bearer fake-token' }
        };
        const res = {
            status: function(code) {
                statusCode = code;
                return this;
            },
            json: function(data) {
                responseJson = data;
                return this;
            }
        };
        const next = () => {};

        await protect(req, res, next);
        
        if (statusCode === 503 && responseJson.message.includes('unavailable')) {
            console.log("✅ Passed: Returned 503 Database temporarily unavailable.");
            testsPassed++;
        } else {
            console.log(`❌ Failed: Returned ${statusCode} instead of 503. Message: ${responseJson?.message}`);
        }
    } catch (e) {
        console.log("❌ Failed:", e.message);
    }

    // Restore DB Connection state
    Object.defineProperty(mongoose.connection, 'readyState', { value: originalReadyState, writable: true });

    // TEST 5: Verify ConnectDB Options
    console.log("\nTest 5: Verify ConnectDB Options contain resilience parameters");
    const fs = require('fs');
    const path = require('path');
    const dbFile = fs.readFileSync(path.join(__dirname, '../config/db.js'), 'utf8');
    
    if (dbFile.includes('family: 4') && dbFile.includes('serverSelectionTimeoutMS: 10000')) {
        console.log("✅ Passed: Found family: 4 and serverSelectionTimeoutMS: 10000 in DB config.");
        testsPassed++;
    } else {
        console.log("❌ Failed: Resilience parameters not found in db.js");
    }

    console.log("\n=======================================");
    console.log(`   Tests Passed: ${testsPassed} / ${totalTests}`);
    console.log("=======================================\n");

    if (testsPassed === totalTests) {
        process.exit(0);
    } else {
        process.exit(1);
    }
}

runTests();
