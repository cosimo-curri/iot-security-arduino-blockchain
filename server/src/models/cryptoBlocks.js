const mongoose = require("mongoose");

const cryptoBlockSchema = new mongoose.Schema({
    timestamp: { type: Number, required: true },
    data: { type: mongoose.Schema.Types.Double, required: true },
    previousHash: { type: String, default: "" },
    hash: { type: String, required: true },
    nonce: { type: Number, required: true }
});

module.exports = mongoose.model("CryptoBlock", cryptoBlockSchema);
