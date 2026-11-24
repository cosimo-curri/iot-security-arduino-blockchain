function parseHex(value, byteLength) {
    if (typeof value !== "string" || value.length !== byteLength * 2 ||
        !/^[0-9a-fA-F]+$/.test(value)) {
        throw new TypeError(`Expected ${byteLength} bytes of hexadecimal data`);
    }
    return Buffer.from(value, "hex");
}

function isLoopback(address) {
    return address === "127.0.0.1" || address === "::1" ||
        address === "::ffff:127.0.0.1";
}

module.exports = { parseHex, isLoopback };
