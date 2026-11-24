const { installBlockchainSocketHandler } = require("../socket_handlers/blockchainSocketHandler");

function configureSockets(io, blockchain, options = {}) {
    const namespace = io.of("/socket/blockchain");
    installBlockchainSocketHandler(namespace, blockchain, options);
    return namespace;
}

module.exports = { configureSockets };
