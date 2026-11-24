function installBlockchainSocketHandler(namespace, blockchain, { peerToken = "" } = {}) {
    namespace.use((socket, next) => {
        // Local demo connections are permitted; remote peers must authenticate.
        const remoteAddress = socket.handshake.address;
        const local = remoteAddress === "127.0.0.1" || remoteAddress === "::1" ||
            remoteAddress === "::ffff:127.0.0.1";
        if (local || (peerToken && socket.handshake.auth?.token === peerToken)) {
            return next();
        }
        next(new Error("Unauthenticated blockchain peer"));
    });

    namespace.on("connection", (socket) => {
        socket.on("sendNewBlock", async (data) => {
            try {
                const accepted = await blockchain.acceptRemoteBlock(data);
                if (accepted) namespace.emit("receiveNewBlock", data);
            } catch (error) {
                console.error(`SERVER: rejected remote block: ${error.message}`);
                socket.emit("blockRejected", "Invalid block or inconsistent chain tip");
            }
        });
    });
}

module.exports = { installBlockchainSocketHandler };
