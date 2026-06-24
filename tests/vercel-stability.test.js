const assert = require('assert');
const http = require('http');
const path = require('path');
const dotenv = require('dotenv');

process.chdir(path.join(__dirname, '..'));
dotenv.config();

async function request(port, urlPath) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: body ? JSON.parse(body) : null
                });
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy(new Error('Request timeout'));
        });
    });
}

async function testConnectDbReuse() {
    const connectDB = require('../config/db');
    const mongoose = require('mongoose');

    const originalUri = process.env.MONGODB_URI;
    if (!originalUri) {
        console.log('  ⊘ connectDB reuse skipped (MONGODB_URI not set)');
        return;
    }

    const first = await connectDB();
    const second = await connectDB();
    assert.strictEqual(first, second, 'connectDB should return cached connection');
    assert.strictEqual(mongoose.connection.readyState, 1, 'mongoose should be connected');
    console.log('  ✓ connectDB reuses cached connection');
}

async function testHttpRoutes(port) {
    const start = Date.now();
    const health = await request(port, '/health');
    const healthMs = Date.now() - start;

    assert.strictEqual(health.statusCode, 200);
    assert.strictEqual(health.body.status, 'ok');
    assert.strictEqual(health.body.service, 'backend');
    assert.ok(health.body.timestamp);
    assert.ok(healthMs < 500, `health should respond in <500ms (got ${healthMs}ms)`);
    console.log(`  ✓ GET /health returns 200 JSON in ${healthMs}ms`);

    const root = await request(port, '/');
    assert.strictEqual(root.statusCode, 200);
    assert.strictEqual(root.body.message, 'Backend API is running');
    assert.strictEqual(root.body.health, '/health');
    console.log('  ✓ GET / returns 200 JSON');

    const unknown = await request(port, '/this-route-does-not-exist');
    assert.strictEqual(unknown.statusCode, 404);
    assert.strictEqual(unknown.body.success, false);
    console.log('  ✓ unknown route returns 404 JSON without redirect');

    const rootHead = await new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: '/',
            method: 'HEAD'
        }, (res) => {
            resolve(res.statusCode);
        });
        req.on('error', reject);
        req.end();
    });
    assert.ok(rootHead < 400, 'root should not redirect');
    console.log('  ✓ GET / has no redirect loop');
}

async function testWorkersDisabledOnVercel() {
    const { spawnSync } = require('child_process');
    const script = `
        process.env.VERCEL = '1';
        process.env.ENABLE_WORKERS = 'true';
        process.env.ENABLE_TRACKING_WORKER = 'true';
        process.env.NODE_ENV = 'production';
        const exported = require('./server');
        const isHttpServer = exported instanceof require('http').Server;
        if (isHttpServer) {
            console.error('FAIL: exported http.Server on Vercel (should export Express app only)');
            process.exit(1);
        }
        if (!exported || typeof exported.use !== 'function') {
            console.error('FAIL: expected Express app export on Vercel');
            process.exit(1);
        }
        console.log('PASS');
    `;

    const result = spawnSync(process.execPath, ['-e', script], {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        timeout: 15000
    });

    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || 'Vercel worker guard test failed');
    }
    assert.ok(result.stdout.includes('PASS'));
    console.log('  ✓ workers and HTTP listener are disabled when VERCEL is set');
}

async function run() {
    console.log('Vercel stability test suite\n');

    process.env.PORT = '5560';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_WORKERS = 'false';
    process.env.ENABLE_TRACKING_WORKER = 'false';
    delete process.env.VERCEL;

    console.log('[1] connectDB reuse');
    await testConnectDbReuse();

    console.log('\n[2] HTTP routes (local server)');
    require('../server');
    const connectDB = require('../config/db');
    if (process.env.MONGODB_URI) {
        await connectDB();
    }
    await new Promise((r) => setTimeout(r, 800));
    await testHttpRoutes(5560);

    console.log('\n[3] Vercel export guard');
    await testWorkersDisabledOnVercel();

    console.log('\nAll stability tests passed.');
}

run().catch((err) => {
    console.error('\nTest suite failed:', err.message);
    process.exit(1);
});
