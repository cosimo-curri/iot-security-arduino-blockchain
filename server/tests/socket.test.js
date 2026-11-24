const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Server } = require("socket.io");
const { io } = require("socket.io-client");
const { CryptoBlockchain } = require("../src/blockchain");
const { configureSockets } = require("../src/routes/socket");

function model() {
    const rows = [];
    return {
        rows,
        find() { return { sort: async () => rows.map((row) => ({ ...row })) }; },
        async create(row) { rows.push({ ...row }); }
    };
}

function receive(socket, event) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 3000);
        socket.once(event, (data) => { clearTimeout(timeout); resolve(data); });
    });
}

test("Socket.IO accepts, persists, broadcasts and rejects forged blocks", async () => {
    const serverChain = new CryptoBlockchain({ model: model(), difficulty: 1 });
    const source = new CryptoBlockchain({ model: model(), difficulty: 1 });
    await serverChain.initialize();
    await source.initialize();
    const server = http.createServer();
    const ioServer = new Server(server);
    configureSockets(ioServer, serverChain);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const client = io(`http://127.0.0.1:${server.address().port}/socket/blockchain`);
    try {
        await receive(client, "connect");
        const valid = await source.addNewBlock(24.5);
        const event = receive(client, "receiveNewBlock");
        client.emit("sendNewBlock", valid);
        const received = await event;
        assert.equal(received.hash, valid.hash);
        assert.equal(serverChain.obtainLatestBlock().data, 24.5);
        assert.equal(serverChain.checkChainValidity(), true);
        const rejectedEvent = receive(client, "blockRejected");
        client.emit("sendNewBlock", { ...valid, hash: "a".repeat(64) });
        assert.match(await rejectedEvent, /Invalid block/);
        assert.equal(serverChain.blockchain.length, 2);
    } finally {
        client.disconnect();
        await new Promise((resolve) => ioServer.close(resolve));
    }
});
