const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'memory_growth_log.csv');

// Initialize the CSV file with headers
fs.writeFileSync(LOG_FILE, 'timestamp_ms,elapsed_min,rss_mb,heapUsed_mb,heapTotal_mb,external_mb\n');

const startTime = Date.now();
console.log(`[MEMORY WATCHER] Started. Logging memory growth to ${LOG_FILE} every 30s...`);

const memoryWatcher = setInterval(() => {
    const m = process.memoryUsage();
    const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(2);
    const line = `${Date.now()},${elapsedMin},${(m.rss / 1024 / 1024).toFixed(2)},${(m.heapUsed / 1024 / 1024).toFixed(2)},${(m.heapTotal / 1024 / 1024).toFixed(2)},${(m.external / 1024 / 1024).toFixed(2)}\n`;
    
    fs.appendFileSync(LOG_FILE, line);
    
    const heapPercent = ((m.heapUsed / m.heapTotal) * 100).toFixed(1);
    if (m.heapUsed / m.heapTotal > 0.85) {
        console.error(`[MEMORY ALERT] Heap at ${heapPercent}% — possible leak: ${(m.heapUsed / 1024 / 1024).toFixed(1)} MB used of ${(m.heapTotal / 1024 / 1024).toFixed(1)} MB total`);
    }
}, 30000);

module.exports = {
    stopMemoryWatcher: () => {
        clearInterval(memoryWatcher);
        console.log('[MEMORY WATCHER] Stopped.');
    }
};
