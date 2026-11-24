const express = require("express");
const crypto = require("node:crypto");
const { ec: EC } = require("elliptic");
const { parseHex, isLoopback } = require("../utils");

const ec = new EC("p192");
const SESSION_LIFETIME_MS = 5 * 60 * 1000;

function createApiRouter({ blockchain, publishBlock = () => {},
    allowUnregisteredSigners = false, authorizedSigningKeys = [],
    allowRemoteApi = false, loadAscon = () => import("ascon-js") }) {
    const router = express.Router();
    const registered = new Set(authorizedSigningKeys.map((key) => key.trim().toLowerCase()).filter(Boolean));
    let session = null; // One active serial Arduino session per server.

    router.use((req, res, next) => {
        if (!allowRemoteApi && !isLoopback(req.socket.remoteAddress)) {
            return res.status(403).send("ERROR: API is restricted to localhost");
        }
        next();
    });

    router.post("/arduinoPublic1", (req, res) => {
        try {
            const publicKey = parseHex(req.body?.value?.public1_hex, 41);
            if (publicKey[0] !== 0x04) throw new TypeError("Uncompressed ECDH key required");
            const ecdh = crypto.createECDH("secp160r1");
            const serverPublicKey = ecdh.generateKeys();
            const sharedSecret = ecdh.computeSecret(publicKey); // Also validates the point.
            if (sharedSecret.length !== 20) throw new Error("Unexpected secret size");
            session = { secret: sharedSecret, expiresAt: Date.now() + SESSION_LIFETIME_MS };
            return res.type("text/plain").send(serverPublicKey.toString("hex"));
        } catch {
            session = null;
            return res.status(400).send("ERROR: invalid ECDH public key");
        }
    });

    router.post("/newMeasure", async (req, res) => {
        const active = session;
        if (!active || Date.now() > active.expiresAt || active.busy) {
            return res.status(409).send("ERROR: ECDH handshake required or already in use");
        }
        // Claim the session synchronously, before dynamic imports or database work.
        // Otherwise concurrent HTTP requests can both use the same shared secret.
        active.busy = true;
        try {
            const value = req.body?.value;
            const ciphertext = parseHex(value?.cipher_text, 20); // 4-byte float + 16-byte tag.
            const nonce = parseHex(value?.nonce, 16);
            const associatedData = parseHex(value?.associated_data, 16);
            const signature = parseHex(value?.signature, 48);
            const publicKey = parseHex(value?.public_arduino_hash, 49);
            if (publicKey[0] !== 0x04) throw new TypeError("Invalid ECDSA public key");
            const encodedPublicKey = publicKey.toString("hex");
            if (!allowUnregisteredSigners && !registered.has(encodedPublicKey)) {
                return res.status(403).send("ERROR: signing key is not enrolled");
            }
            const { Ascon } = await loadAscon();
            const hash = Buffer.from(Ascon.hash(ciphertext, { variant: "Ascon-Hash" }));
            const signer = ec.keyFromPublic(encodedPublicKey, "hex");
            const validSignature = signer.verify(hash, {
                r: signature.subarray(0, 24),
                s: signature.subarray(24, 48)
            });
            if (!validSignature) return res.status(400).send("ERROR: invalid signature");
            const plaintext = Ascon.decrypt(active.secret, nonce, ciphertext, {
                variant: "Ascon-80pq", associatedData
            });
            if (!plaintext || plaintext.length !== 4) {
                throw new TypeError("Invalid decrypted temperature size");
            }
            const temperature = Buffer.from(plaintext).readFloatLE(0);
            if (!Number.isFinite(temperature)) throw new TypeError("Invalid temperature");
            // Consuming a claimed session prevents two overlapping valid requests
            // or retries after a successful cryptographic verification.
            if (session === active) session = null;
            let block;
            try {
                block = await blockchain.addNewBlock(temperature);
            } catch (error) {
                console.error(`SERVER: measurement persistence failed: ${error.message}`);
                return res.status(500).send("ERROR: measurement persistence failed");
            }
            // A notification failure must not report a persisted measurement as rejected.
            try {
                publishBlock(block);
            } catch (error) {
                console.error(`SERVER: block notification failed: ${error.message}`);
            }
            return res.type("text/plain").send("OK");
        } catch (error) {
            console.error(`SERVER: measurement rejected: ${error.message}`);
            return res.status(400).send("ERROR: invalid measurement");
        } finally {
            active.busy = false;
        }
    });

    return router;
}

module.exports = { createApiRouter };
