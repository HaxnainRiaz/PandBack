const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'memory_growth_log.csv');

if (!fs.existsSync(LOG_FILE)) {
    console.error(`ERROR: CSV file ${LOG_FILE} not found. Run the watcher and load generator first.`);
    process.exit(1);
}

const content = fs.readFileSync(LOG_FILE, 'utf8').trim();
const lines = content.split('\n').slice(1);

if (lines.length < 2) {
    console.error('ERROR: Insufficient readings in memory growth log CSV.');
    process.exit(1);
}

const readings = lines.map(l => {
    const [ts, min, rss, heap, total, ext] = l.split(',');
    return {
        ts: parseInt(ts),
        min: parseFloat(min),
        rss: parseFloat(rss),
        heap: parseFloat(heap),
        total: parseFloat(total),
        ext: parseFloat(ext)
    };
});

// Take average of first 10 and last 10 readings to prevent single-spike skewing
const sampleSize = Math.min(10, Math.floor(readings.length / 2));
const firstSamples = readings.slice(0, sampleSize);
const lastSamples = readings.slice(-sampleSize);

const avgFirstHeap = firstSamples.reduce((s, r) => s + r.heap, 0) / sampleSize;
const avgLastHeap = lastSamples.reduce((s, r) => s + r.heap, 0) / sampleSize;
const heapGrowth = avgLastHeap - avgFirstHeap;
const maxRss = Math.max(...readings.map(r => r.rss));

console.log('\n=============================================');
console.log('         MEMORY GROWTH SLOPE ANALYSIS        ');
console.log('=============================================');
console.log(`Heap at start (avg): ${avgFirstHeap.toFixed(2)} MB`);
console.log(`Heap at end (avg):   ${avgLastHeap.toFixed(2)} MB`);
console.log(`Total heap growth:   ${heapGrowth.toFixed(2)} MB`);
console.log(`Peak RSS memory:     ${maxRss.toFixed(2)} MB`);
console.log(`Total readings:      ${readings.length}`);
console.log(`Monitoring duration: ${readings[readings.length - 1].min.toFixed(2)} minutes`);
console.log('---------------------------------------------');

if (heapGrowth > 20) {
    console.error('❌ FAIL: Heap grew more than 20 MB — possible memory leak detected!');
    process.exit(1);
} else if (heapGrowth > 10) {
    console.log('⚠️ WARN: Heap grew between 10-20 MB — monitor closely in production.');
    process.exit(0);
} else {
    console.log('✅ PASS: Heap growth is stable and within acceptable plateau range (< 10 MB).');
    process.exit(0);
}
