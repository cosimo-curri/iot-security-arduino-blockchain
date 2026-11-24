const test = require("node:test");
const assert = require("node:assert/strict");
const { CryptoBlock, CryptoBlockchain, computeHash } = require("../src/blockchain");

function inMemoryModel() {
    const documents = [];
    let failNext = false;
    return {
        documents,
        failOnNextSave() { failNext = true; },
        find() { return { sort: async () => documents.map((item) => ({ ...item })) }; },
        async create(block) {
            if (failNext) { failNext = false; throw new Error("database unavailable"); }
            documents.push({ ...block });
        }
    };
}

test("genesis is deterministic and validates when loaded from storage", async () => {
    const model = inMemoryModel();
    const first = new CryptoBlockchain({ model, difficulty: 1 });
    await first.initialize();
    assert.equal(first.blockchain.length, 1);
    assert.equal(first.blockchain[0].nonce, 0);
    assert.equal(first.blockchain[0].hash, computeHash(first.blockchain[0]));
    const second = new CryptoBlockchain({ model, difficulty: 1 });
    await second.initialize();
    assert.equal(second.blockchain[0].hash, first.blockchain[0].hash);
    assert.equal(second.checkChainValidity(), true);
});

test("mined data persists and is checked after database reload", async () => {
    const model = inMemoryModel();
    const chain = new CryptoBlockchain({ model, difficulty: 1 });
    await chain.initialize();
    const block = await chain.addNewBlock(new CryptoBlock(23.75));
    assert.equal(block.hash, computeHash(block));
    assert.ok(block.hash.startsWith("0"));
    assert.equal(chain.checkChainValidity(), true);
    const reloaded = new CryptoBlockchain({ model, difficulty: 1 });
    await reloaded.initialize();
    assert.equal(reloaded.obtainLatestBlock().data, 23.75);
});

test("tampering or an invalid proof of work is rejected", async () => {
    const model = inMemoryModel();
    const chain = new CryptoBlockchain({ model, difficulty: 1 });
    await chain.initialize();
    const block = await chain.addNewBlock(12);
    chain.blockchain[1].data = 99;
    assert.equal(chain.checkChainValidity(), false);
    chain.blockchain[1].data = 12;
    assert.equal(chain.checkChainValidity(), true);
    const remote = { ...block, data: 13, timestamp: block.timestamp + 100, hash: "a".repeat(64) };
    await assert.rejects(chain.acceptRemoteBlock(remote), /Remote block/);
});

test("failed persistence never publishes a block to the in-memory chain", async () => {
    const model = inMemoryModel();
    const chain = new CryptoBlockchain({ model, difficulty: 1 });
    await chain.initialize();
    model.failOnNextSave();
    await assert.rejects(chain.addNewBlock(5), /database unavailable/);
    assert.equal(chain.blockchain.length, 1);
    await chain.addNewBlock(6);
    assert.equal(chain.blockchain.length, 2);
});

test("concurrent mining is serialized and extends the correct tip", async () => {
    const model = inMemoryModel();
    const chain = new CryptoBlockchain({ model, difficulty: 1 });
    await chain.initialize();
    await Promise.all([chain.addNewBlock(1), chain.addNewBlock(2), chain.addNewBlock(3)]);
    assert.equal(chain.blockchain.length, 4);
    assert.equal(chain.checkChainValidity(), true);
});

test("remote blocks are verified, persisted and deduplicated", async () => {
    const upstream = new CryptoBlockchain({ model: inMemoryModel(), difficulty: 1 });
    const downstreamModel = inMemoryModel();
    const downstream = new CryptoBlockchain({ model: downstreamModel, difficulty: 1 });
    await upstream.initialize();
    await downstream.initialize();
    const block = await upstream.addNewBlock(20.5);
    assert.equal(await downstream.acceptRemoteBlock(block), true);
    assert.equal(await downstream.acceptRemoteBlock(block), false);
    assert.equal(downstream.checkChainValidity(), true);
    assert.equal(downstreamModel.documents.length, 2);
});

test("inconsistent nonce/hash is rejected without modifying stored blocks", async () => {
    const model = inMemoryModel();
    await new CryptoBlockchain({ model, difficulty: 1 }).initialize();
    model.documents[0].hash = "f".repeat(64);
    await assert.rejects(
        new CryptoBlockchain({ model, difficulty: 1 }).initialize(),
        /invalid or incompatible/
    );
});

test("Mongoose validates genesis and the BSON Double round-trips as a number", () => {
    const Model = require("../src/models/cryptoBlocks");
    const { asPlainBlock } = require("../src/blockchain");
    const genesis = new CryptoBlock(0, "", 0);
    const document = new Model(genesis);
    assert.equal(document.validateSync(), undefined);
    assert.equal(asPlainBlock(document).data, 0);
    const measurement = new Model(new CryptoBlock(21.25, genesis.hash));
    assert.equal(measurement.validateSync(), undefined);
    assert.equal(asPlainBlock(measurement).data, 21.25);
});


test("remote block parser rejects nonnumeric values rather than coercing them", async () => {
    const { asPlainBlock } = require("../src/blockchain");
    const valid = new CryptoBlock(21.5, "", 0);
    assert.equal(asPlainBlock(valid).data, 21.5);
    for (const nonnumeric of [[], {}, "21.5", true, false, null, undefined, [21.5], NaN, Infinity]) {
        assert.throws(() => asPlainBlock({ ...valid, data: nonnumeric }),
            /Block data must be a finite number/);
    }
    const upstream = new CryptoBlockchain({ model: inMemoryModel(), difficulty: 1 });
    const downstream = new CryptoBlockchain({ model: inMemoryModel(), difficulty: 1 });
    await upstream.initialize();
    await downstream.initialize();
    const mined = await upstream.addNewBlock(21.5);
    await assert.rejects(downstream.acceptRemoteBlock({ ...mined, data: [] }),
        /Block data must be a finite number/);
    assert.equal(downstream.blockchain.length, 1);
});
