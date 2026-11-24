const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { provisionDevice } = require("../scripts/provision-device");

test("provisioning generates a persistent P-192 identity without overwriting secrets", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "iot-device-"));
    const destination = path.join(directory, "device_identity.h");
    try {
        const result = provisionDevice(destination);
        const contents = fs.readFileSync(destination, "utf8");
        assert.match(contents, /PRIVATE KEY: DO NOT COMMIT/);
        assert.equal(result.publicKeyHex.length, 98);
        const entries = contents.match(/0x[0-9a-f]{2}/g).map((value) => Number(value));
        const ecdh = crypto.createECDH("prime192v1");
        ecdh.setPrivateKey(Buffer.from(entries.slice(0, 24)));
        assert.equal(ecdh.getPublicKey(undefined, "uncompressed").toString("hex"), result.publicKeyHex);
        assert.deepEqual(entries.slice(24), Array.from(Buffer.from(result.publicKeyHex, "hex").subarray(1)));
        assert.throws(() => provisionDevice(destination), { code: "EEXIST" });
        assert.equal(fs.readFileSync(destination, "utf8"), contents);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
