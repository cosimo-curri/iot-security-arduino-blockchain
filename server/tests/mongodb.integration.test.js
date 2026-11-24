const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { CryptoBlockchain } = require("../src/blockchain");
const cryptoBlockSchema = require("../src/models/cryptoBlocks").schema;

// Opt-in integration test: MONGO_TEST_URI must reference an expendable test DB.
// This test creates and drops ONLY a uniquely named collection of its own.
test("real MongoDB stores, reloads and rejects corrupted blocks", {
    skip: !process.env.MONGO_TEST_URI && "Set MONGO_TEST_URI to run the real-database integration test"
}, async () => {
    const conn = await mongoose.createConnection(process.env.MONGO_TEST_URI, {
        serverSelectionTimeoutMS: 5000
    }).asPromise();
    const collection = `iot_security_test_${crypto.randomUUID().replace(/-/g, "")}`;
    const model = conn.model(`CryptoBlockTest_${collection}`, cryptoBlockSchema, collection);
    try {
        const blockchain = new CryptoBlockchain({ model, difficulty: 1 });
        await blockchain.initialize();
        const mined = await blockchain.addNewBlock(21.5);
        assert.equal(mined.data, 21.5);
        assert.equal(await model.countDocuments(), 2);
        const reloaded = new CryptoBlockchain({ model, difficulty: 1 });
        await reloaded.initialize();
        assert.equal(reloaded.obtainLatestBlock().hash, mined.hash);
        assert.equal(reloaded.checkChainValidity(), true);
        await model.updateOne({ hash: mined.hash }, { $set: { data: 99.25 } });
        await assert.rejects(
            new CryptoBlockchain({ model, difficulty: 1 }).initialize(),
            /Stored blockchain is invalid/
        );
    } finally {
        try { await model.collection.drop(); } finally { await conn.close(); }
    }
});
