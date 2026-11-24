require("dotenv").config();

const http = require("node:http");
const express = require("express");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { io: connectPeer } = require("socket.io-client");
const { CryptoBlockchain } = require("./blockchain");
const { createApiRouter } = require("./routes/api");
const { configureSockets } = require("./routes/socket");
const { startSerialBridge } = require("./serialBridge");

async function startServer(env = process.env) {
    const port = Number(env.PORT || "3000");
    const host = env.HOST || "127.0.0.1";
    const mongoUri = env.MONGODB_URI;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("PORT must be a valid TCP port");
    }
    if (!mongoUri) throw new Error("Set MONGODB_URI in your private .env file");
    if (host !== "127.0.0.1" && host !== "::1" && !env.PEER_SHARED_TOKEN) {
        throw new Error("Public network binding requires PEER_SHARED_TOKEN");
    }

    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
    const blockchain = new CryptoBlockchain();
    await blockchain.initialize();
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "8kb" }));
    const httpServer = http.createServer(app);
    const socketServer = new Server(httpServer);
    const namespace = configureSockets(socketServer, blockchain, {
        peerToken: env.PEER_SHARED_TOKEN || ""
    });
    const outboundPeers = [];
    const peerUrls = (env.PEER_URLS || "").split(",").map((url) => url.trim()).filter(Boolean);
    for (const url of peerUrls) {
        const socket = connectPeer(`${url.replace(/\/$/, "")}/socket/blockchain`, {
            auth: { token: env.PEER_SHARED_TOKEN || "" }
        });
        socket.on("receiveNewBlock", async (block) => {
            try {
                const accepted = await blockchain.acceptRemoteBlock(block);
                if (accepted) namespace.emit("receiveNewBlock", block);
            } catch (error) {
                console.error(`SERVER: peer synchronization failed: ${error.message}`);
            }
        });
        socket.on("connect_error", (error) => console.error(`SERVER: peer connection failed: ${error.message}`));
        outboundPeers.push(socket);
    }
    const publishBlock = (block) => {
        namespace.emit("receiveNewBlock", block);
        for (const peer of outboundPeers) peer.emit("sendNewBlock", block);
    };
    app.use("/api", createApiRouter({
        blockchain,
        publishBlock,
        allowUnregisteredSigners: env.ALLOW_UNREGISTERED_SIGNERS === "true",
        authorizedSigningKeys: (env.AUTHORIZED_SIGNING_KEYS || "").split(",").filter(Boolean),
        allowRemoteApi: env.ALLOW_REMOTE_API === "true"
    }));
    app.get("/health", (_, res) => res.json({ status: "ok", chainLength: blockchain.blockchain.length }));

    await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, resolve);
    });
    console.log(`SERVER: listening on http://${host}:${port}`);
    const serialPort = startSerialBridge({
        path: env.ARDUINO_COM_PORT,
        port,
        baseUrl: host === "::1" ? "http://[::1]" : "http://127.0.0.1"
    });
    return { app, blockchain, httpServer, socketServer, outboundPeers, serialPort };
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error(`SERVER: startup failed: ${error.message}`);
        process.exitCode = 1;
        mongoose.disconnect().catch(() => {});
    });
}

module.exports = { startServer };
