/**
 * One-time migration: Fix duplicate orderNumbers and rebuild the index as sparse+unique.
 *
 * Run once: node fix-order-index.js
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

function randomOrderNumber() {
    return `#${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function fixOrderIndex() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.\n');

        const collection = mongoose.connection.collection('orders');

        // ── Step 1: Show current indexes ────────────────────────────────────────
        const indexes = await collection.indexes();
        console.log('Current indexes on orders collection:');
        indexes.forEach(idx => console.log(' -', JSON.stringify(idx)));
        console.log();

        // ── Step 2: Fix duplicate orderNumbers ─────────────────────────────────
        console.log('Scanning for duplicate orderNumbers...');

        const pipeline = [
            { $group: { _id: '$orderNumber', count: { $sum: 1 }, ids: { $push: '$_id' } } },
            { $match: { count: { $gt: 1 } } }
        ];

        const duplicateGroups = await collection.aggregate(pipeline).toArray();

        if (duplicateGroups.length === 0) {
            console.log('✅ No duplicate orderNumbers found.\n');
        } else {
            console.log(`⚠️  Found ${duplicateGroups.length} duplicate group(s). Fixing...\n`);

            // Collect all existing orderNumbers to avoid collision when assigning new ones
            const allOrderNumbers = new Set(
                (await collection.find({}, { projection: { orderNumber: 1 } }).toArray())
                    .map(o => o.orderNumber)
                    .filter(Boolean)
            );

            let fixed = 0;
            for (const group of duplicateGroups) {
                const { _id: dupNumber, ids } = group;
                // Keep the FIRST occurrence (oldest _id), reassign all others
                const [keep, ...reassign] = ids;

                console.log(`  Duplicate: "${dupNumber}" — keeping doc ${keep}, reassigning ${reassign.length} doc(s)`);

                for (const docId of reassign) {
                    // Generate a guaranteed-unique number
                    let newNumber;
                    do {
                        newNumber = randomOrderNumber();
                    } while (allOrderNumbers.has(newNumber));
                    allOrderNumbers.add(newNumber);

                    await collection.updateOne(
                        { _id: docId },
                        { $set: { orderNumber: newNumber } }
                    );
                    console.log(`    ↳ Doc ${docId} reassigned → ${newNumber}`);
                    fixed++;
                }
            }
            console.log(`\n✅ Fixed ${fixed} duplicate document(s).\n`);
        }

        // ── Step 3: Fix documents with missing orderNumbers ─────────────────────
        console.log('Checking for documents missing orderNumber...');
        const missing = await collection.find(
            { $or: [{ orderNumber: { $exists: false } }, { orderNumber: null }, { orderNumber: '' }] }
        ).toArray();

        if (missing.length > 0) {
            console.log(`⚠️  Found ${missing.length} document(s) without an orderNumber. Assigning...`);

            const allOrderNumbers = new Set(
                (await collection.find({}, { projection: { orderNumber: 1 } }).toArray())
                    .map(o => o.orderNumber)
                    .filter(Boolean)
            );

            for (const doc of missing) {
                let newNumber;
                do {
                    newNumber = randomOrderNumber();
                } while (allOrderNumbers.has(newNumber));
                allOrderNumbers.add(newNumber);

                await collection.updateOne(
                    { _id: doc._id },
                    { $set: { orderNumber: newNumber } }
                );
                console.log(`  ↳ Doc ${doc._id} assigned → ${newNumber}`);
            }
            console.log('✅ All missing orderNumbers assigned.\n');
        } else {
            console.log('✅ All documents have an orderNumber.\n');
        }

        // ── Step 4: Drop old index if it exists ────────────────────────────────
        try {
            await collection.dropIndex('orderNumber_1');
            console.log('✅ Dropped old orderNumber_1 index.');
        } catch (e) {
            if (e.codeName === 'IndexNotFound') {
                console.log('ℹ️  orderNumber_1 index not found — skipping drop.');
            } else {
                console.warn('⚠️  Could not drop index:', e.message);
            }
        }

        // ── Step 5: Recreate as sparse + unique ────────────────────────────────
        await collection.createIndex(
            { orderNumber: 1 },
            { unique: true, sparse: true, name: 'orderNumber_1' }
        );
        console.log('✅ Recreated orderNumber index as sparse + unique.\n');

        // ── Step 6: Verify ─────────────────────────────────────────────────────
        const newIndexes = await collection.indexes();
        console.log('Final indexes on orders collection:');
        newIndexes.forEach(idx => console.log(' -', JSON.stringify(idx)));

        console.log('\n✅ Migration complete. Restart your backend server now.');
        process.exit(0);
    } catch (err) {
        console.error('\n❌ Migration failed:', err.message);
        process.exit(1);
    }
}

fixOrderIndex();
