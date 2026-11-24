#!/usr/bin/env node
// Local, explicit provisioning of a persistent demo-device signing identity.
// The private key is written only to the ignored Arduino header, never to stdout.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const defaultHeaderPath = path.resolve(__dirname, "../../arduino/curri_jawhariidrissi/device_identity.h");

function toByteList(bytes) {
    return Array.from(bytes, (value) => `0x${value.toString(16).padStart(2, "0")}`).join(", ");
}

function provisionDevice(headerPath = defaultHeaderPath) {
    const identity = crypto.createECDH("prime192v1");
    const publicKey = identity.generateKeys(undefined, "uncompressed");
    const privateKey = identity.getPrivateKey();
    if (publicKey.length !== 49 || privateKey.length !== 24 || publicKey[0] !== 4) {
        throw new Error("Unexpected secp192r1 signing key format");
    }
    const header = `// Locally provisioned device identity. PRIVATE KEY: DO NOT COMMIT OR SHARE.\n` +
        `// Generated for a teaching prototype; AVR firmware does not protect keys from extraction.\n` +
        `#ifndef ARDUINO_BLOCKCHAIN_DEVICE_IDENTITY_H\n` +
        `#define ARDUINO_BLOCKCHAIN_DEVICE_IDENTITY_H\n` +
        `#include <Arduino.h>\n` +
        `#include <avr/pgmspace.h>\n` +
        `static const uint8_t DEVICE_SIGNING_PRIVATE_KEY[24] PROGMEM = {${toByteList(privateKey)}};\n` +
        `static const uint8_t DEVICE_SIGNING_PUBLIC_KEY[48] PROGMEM = {${toByteList(publicKey.subarray(1))}};\n` +
        `#endif\n`;
    try {
        // Never overwrite an established identity; doing so would invalidate enrollment.
        fs.writeFileSync(headerPath, header, { flag: "wx", mode: 0o600 });
    } finally {
        privateKey.fill(0);
    }
    return { publicKeyHex: publicKey.toString("hex"), headerPath };
}

if (require.main === module) {
    try {
        const result = provisionDevice();
        console.log(`Provisioned ignored Arduino header: ${result.headerPath}`);
        console.log(`Add this public key to AUTHORIZED_SIGNING_KEYS in your private .env:\n${result.publicKeyHex}`);
        console.log("Keep ALLOW_UNREGISTERED_SIGNERS=false. Do not commit the header or distribute the compiled firmware image.");
    } catch (error) {
        console.error(`Provisioning failed: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { provisionDevice };
