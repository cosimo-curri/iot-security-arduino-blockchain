const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const { ec: EC } = require("elliptic");
const { createApiRouter } = require("../src/routes/api");

const ec = new EC("p192");

async function fixture(options = {}) {
    const accepted = [];
    const published = [];
    const app = express();
    app.use(express.json());
    app.use("/api", createApiRouter({
        blockchain: { addNewBlock: async (value) => { accepted.push(value); return { data: value }; } },
        publishBlock: (block) => published.push(block),
        allowUnregisteredSigners: true,
        ...options
    }));
    const server = await new Promise((resolve) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    return {
        accepted, published,
        async post(path, value) {
            const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ value })
            });
            return { status: response.status, body: await response.text() };
        },
        async close() { await new Promise((resolve) => server.close(resolve)); }
    };
}

async function handshake(f) {
    const arduinoEcdh = crypto.createECDH("secp160r1");
    const arduinoPublic = arduinoEcdh.generateKeys();
    const reply = await f.post("/api/arduinoPublic1", { public1_hex: arduinoPublic.toString("hex") });
    assert.equal(reply.status, 200, reply.body);
    const secret = arduinoEcdh.computeSecret(Buffer.from(reply.body, "hex"));
    return secret;
}

async function signedMeasurement(secret, value = 21.25, key = ec.genKeyPair()) {
    const { Ascon } = await import("ascon-js");
    const nonce = crypto.randomBytes(16);
    const associatedData = crypto.randomBytes(16);
    const payload = Buffer.alloc(4);
    payload.writeFloatLE(value);
    const ciphertext = Buffer.from(Ascon.encrypt(secret, nonce, payload, {
        variant: "Ascon-80pq", associatedData
    }));
    const hash = Buffer.from(Ascon.hash(ciphertext, { variant: "Ascon-Hash" }));
    const signature = key.sign(hash);
    return {
        cipher_text: ciphertext.toString("hex"),
        nonce: nonce.toString("hex"),
        associated_data: associatedData.toString("hex"),
        signature: Buffer.concat([
            signature.r.toArrayLike(Buffer, "be", 24),
            signature.s.toArrayLike(Buffer, "be", 24)
        ]).toString("hex"),
        public_arduino_hash: key.getPublic(false, "hex")
    };
}

test("ECDH, Ascon-80pq, Ascon-Hash and ECDSA create an accepted float32 block", async () => {
    const f = await fixture();
    try {
        const secret = await handshake(f);
        assert.equal(secret.length, 20);
        const data = await signedMeasurement(secret, 21.25);
        const reply = await f.post("/api/newMeasure", data);
        assert.deepEqual(reply, { status: 200, body: "OK" });
        assert.deepEqual(f.accepted, [21.25]);
        assert.equal(f.published.length, 1);
        const replay = await f.post("/api/newMeasure", data);
        assert.equal(replay.status, 409);
    } finally { await f.close(); }
});

test("malformed ECDH keys and missing handshakes are rejected", async () => {
    const f = await fixture();
    try {
        assert.equal((await f.post("/api/arduinoPublic1", { public1_hex: "xyz" })).status, 400);
        assert.equal((await f.post("/api/newMeasure", {})).status, 409);
        assert.deepEqual(f.accepted, []);
    } finally { await f.close(); }
});

test("tampered signatures and authentication tags are rejected", async () => {
    const f = await fixture();
    try {
        const secret = await handshake(f);
        const invalidSignature = await signedMeasurement(secret);
        invalidSignature.signature = "00".repeat(48);
        assert.equal((await f.post("/api/newMeasure", invalidSignature)).status, 400);
        const tampered = await signedMeasurement(secret);
        // Signature is valid for ciphertext, but the nonce is not authenticated by it.
        tampered.nonce = "ff".repeat(16);
        assert.equal((await f.post("/api/newMeasure", tampered)).status, 400);
        assert.deepEqual(f.accepted, []);
    } finally { await f.close(); }
});

test("unregistered ephemeral signing key is rejected by the secure default", async () => {
    const f = await fixture({ allowUnregisteredSigners: false, authorizedSigningKeys: [] });
    try {
        const secret = await handshake(f);
        assert.equal((await f.post("/api/newMeasure", await signedMeasurement(secret))).status, 403);
        assert.deepEqual(f.accepted, []);
    } finally { await f.close(); }
});


test("allowlist accepts a provisioned key and rejects an unknown key", async () => {
    const enrolled = ec.genKeyPair();
    const f = await fixture({ allowUnregisteredSigners: false, authorizedSigningKeys: [enrolled.getPublic(false, "hex")] });
    try {
        let secret = await handshake(f);
        assert.equal((await f.post("/api/newMeasure", await signedMeasurement(secret, 10.5))).status, 403);
        secret = await handshake(f);
        assert.equal((await f.post("/api/newMeasure", await signedMeasurement(secret, 12.5, enrolled))).status, 200);
        assert.deepEqual(f.accepted, [12.5]);
    } finally { await f.close(); }
});

test("concurrent duplicate submissions cannot consume a session twice", async () => {
    const f = await fixture();
    try {
        const secret = await handshake(f);
        const request = await signedMeasurement(secret, 19.25);
        const replies = await Promise.all([
            f.post("/api/newMeasure", request), f.post("/api/newMeasure", request)
        ]);
        assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 409]);
        assert.deepEqual(f.accepted, [19.25]);
    } finally { await f.close(); }
});


test("allowlist trims whitespace around public keys without weakening matching", async () => {
    const enrolled = ec.genKeyPair();
    const publicKey = enrolled.getPublic(false, "hex");
    const f = await fixture({
        allowUnregisteredSigners: false,
        authorizedSigningKeys: [`  ${publicKey.toUpperCase()}  `, ""]
    });
    try {
        const secret = await handshake(f);
        const reply = await f.post("/api/newMeasure", await signedMeasurement(secret, 16.5, enrolled));
        assert.deepEqual(reply, { status: 200, body: "OK" });
        assert.deepEqual(f.accepted, [16.5]);
    } finally { await f.close(); }
});

test("database persistence errors return HTTP 500 and do not publish a block", async () => {
    const f = await fixture({
        blockchain: { addNewBlock: async () => { throw new Error("database unavailable"); } }
    });
    try {
        const secret = await handshake(f);
        const measurement = await signedMeasurement(secret);
        const reply = await f.post("/api/newMeasure", measurement);
        assert.equal(reply.status, 500);
        assert.equal(reply.body, "ERROR: measurement persistence failed");
        assert.deepEqual(f.published, []);
        assert.equal((await f.post("/api/newMeasure", measurement)).status, 409);
    } finally { await f.close(); }
});

test("notification failures do not turn a persisted measurement into a rejected reply", async () => {
    const f = await fixture({ publishBlock: () => { throw new Error("peer unavailable"); } });
    try {
        const secret = await handshake(f);
        assert.deepEqual(await f.post("/api/newMeasure", await signedMeasurement(secret, 17.5)),
            { status: 200, body: "OK" });
        assert.deepEqual(f.accepted, [17.5]);
    } finally { await f.close(); }
});
