const http = require('http');
const axios = require('axios');

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
console.log(`${BOLD}${CYAN}     CAPI HTTP TIMEOUT CORRECTNESS AUDIT     ${RESET}`);
console.log(`${BOLD}${PURPLE}=============================================${RESET}\n`);

async function runCapiTimeoutTest() {
    // 1. Create a mock slow CAPI server
    console.log(`${BLUE}Starting mock slow server on port 9999 (9000ms response delay)...${RESET}`);
    const slowServer = http.createServer((req, res) => {
        setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Delayed response completed' }));
        }, 9000);
    });

    await new Promise(r => slowServer.listen(9999, r));
    console.log(`${GREEN}Mock slow CAPI server is listening on port 9999.${RESET}\n`);

    // 2. Trigger request with Axios having 7000ms timeout
    console.log(`${BLUE}Firing request to slow server with axios timeout threshold = 7000ms...${RESET}`);
    const startTime = Date.now();
    let isPassed = false;

    try {
        await axios.get('http://localhost:9999', { timeout: 7000 });
        console.error(`  ${RED}❌ FAIL: Request succeeded when it should have timed out after 7000ms!${RESET}`);
    } catch (error) {
        const endTime = Date.now();
        const duration = endTime - startTime;
        console.log(`  Request terminated after: ${YELLOW}${duration} ms${RESET}`);
        
        if (error.code === 'ECONNABORTED') {
            console.log(`  ✓ Error code: ${GREEN}${error.code}${RESET} (Axios timeout abort triggered)`);
            
            // Assert timeout occurs within 6500-8000ms
            if (duration >= 6500 && duration <= 8500) {
                console.log(`  ✓ Abort duration: ${GREEN}${duration} ms${RESET} is within the acceptable 6500-8500ms safety window.`);
                isPassed = true;
            } else {
                console.error(`  ${RED}❌ FAIL: Abort duration ${duration} ms is outside the 6500-8500ms window!${RESET}`);
            }
        } else {
            console.error(`  ${RED}❌ FAIL: Request failed with unexpected error code: ${error.code || error.message}${RESET}`);
        }
    }

    // 3. Clean up and close mock server
    console.log('\nShutting down mock slow server...');
    slowServer.close();
    console.log(`${GREEN}Mock server closed.${RESET}\n`);

    if (isPassed) {
        console.log(`${BOLD}${GREEN}✅ CAPI TIMEOUT CORRECTNESS TEST PASSED SUCCESSFULLY!${RESET}\n`);
        process.exit(0);
    } else {
        console.error(`${BOLD}${RED}❌ CAPI TIMEOUT CORRECTNESS TEST FAILED!${RESET}\n`);
        process.exit(1);
    }
}

runCapiTimeoutTest().catch(err => {
    console.error('CAPI timeout test execution error:', err);
    process.exit(1);
});
