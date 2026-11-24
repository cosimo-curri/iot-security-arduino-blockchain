const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { startSerialBridge } = require("../src/serialBridge");

class FakeParser extends EventEmitter {
    constructor(options) {
        super();
        assert.equal(options.delimiter, "\n");
        FakeParser.current = this;
    }
}
class FakePort extends EventEmitter {
    constructor(options) {
        super();
        assert.equal(options.path, "mock:arduino");
        assert.equal(options.baudRate, 9600);
        this.sent = [];
    }
    pipe(parser) { return parser; }
    write(value) { this.sent.push(value); this.emit("sent", value); }
}

function awaitSent(port) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("No reply within 2 seconds")), 2000);
        port.once("sent", (data) => { clearTimeout(timeout); resolve(data); });
    });
}

test("serial bridge transfers only supported JSON APIs and terminates replies", async () => {
    const received = [];
    const port = startSerialBridge({
        path: "mock:arduino", port: 3000, SerialPortImpl: FakePort, ReadlineParserImpl: FakeParser,
        fetchImpl: async (url, options) => {
            received.push({ url, ...JSON.parse(options.body) });
            return { text: async () => "04abc" };
        }
    });
    FakeParser.current.emit("data", "hash signing in progress...");
    assert.equal(port.sent.length, 0);
    const first = awaitSent(port);
    FakeParser.current.emit("data", JSON.stringify({ api: "/api/arduinoPublic1", value: { public1_hex: "abcd" } }));
    assert.equal(await first, "04abc\n");
    assert.deepEqual(received, [{ url: "http://127.0.0.1:3000/api/arduinoPublic1", value: { public1_hex: "abcd" } }]);
    const second = awaitSent(port);
    FakeParser.current.emit("data", JSON.stringify({ api: "/api/deleteEverything", value: {} }));
    assert.equal(await second, "ERROR\n");
    assert.equal(received.length, 1);
});
