const SHA256 = require("crypto-js/sha256");
const CryptoBlockModel = require("./models/cryptoBlocks");

function computeHash(block) {
    return SHA256(
        `${block.previousHash}${block.timestamp}${JSON.stringify(block.data)}${block.nonce}`
    ).toString();
}

function asPlainBlock(source) {
    const fromDocument = source && typeof source.toObject === "function";
    const candidate = fromDocument ? source.toObject() : source;
    if (!candidate || typeof candidate !== "object") {
        throw new TypeError("Invalid block");
    }
    // Mongoose's Double schema produces a BSON Double even after toObject().
    // Only trusted model documents may unwrap it; network blocks must carry
    // a JSON number and never be converted from arrays, strings or objects.
    const rawData = candidate.data;
    const data = fromDocument && rawData?._bsontype === "Double"
        ? rawData.valueOf()
        : rawData;
    if (typeof data !== "number" || !Number.isFinite(data)) {
        throw new TypeError("Block data must be a finite number");
    }
    const block = {
        timestamp: candidate.timestamp,
        data,
        previousHash: candidate.previousHash,
        hash: candidate.hash,
        nonce: candidate.nonce
    };
    if (!Number.isSafeInteger(block.timestamp) || block.timestamp < 0 ||
        !Number.isFinite(block.data) ||
        typeof block.previousHash !== "string" ||
        typeof block.hash !== "string" || !/^[0-9a-f]{64}$/.test(block.hash) ||
        !Number.isSafeInteger(block.nonce) || block.nonce < 0) {
        throw new TypeError("Invalid block fields");
    }
    return block;
}

class CryptoBlock {
    constructor(data, previousHash = "", timestamp = Date.now()) {
        this.timestamp = timestamp;
        this.data = data;
        this.previousHash = previousHash;
        this.nonce = 0; // Must be initialized before computing the hash.
        this.hash = this.computeHash();
    }

    computeHash() {
        return computeHash(this);
    }

    async proofOfWorkAsync(difficulty) {
        if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 8) {
            throw new RangeError("Difficulty must be between 1 and 8");
        }
        const prefix = "0".repeat(difficulty);
        while (!this.hash.startsWith(prefix)) {
            if (this.nonce >= Number.MAX_SAFE_INTEGER) {
                throw new RangeError("Proof-of-work nonce exhausted");
            }
            this.nonce += 1;
            this.hash = this.computeHash();
            // Avoid blocking the serial HTTP bridge during mining.
            await new Promise((resolve) => setImmediate(resolve));
        }
    }
}

class CryptoBlockchain {
    constructor({ model = CryptoBlockModel, difficulty = 4 } = {}) {
        if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 8) {
            throw new RangeError("Invalid proof-of-work difficulty");
        }
        this.model = model;
        this.difficulty = difficulty;
        this.blockchain = [];
        this.writeQueue = Promise.resolve();
    }

    async initialize() {
        // The insertion order of MongoDB results is not guaranteed without sorting.
        const saved = await this.model.find().sort({ _id: 1 });
        if (saved.length === 0) {
            // A deterministic genesis lets new peers agree on the same starting hash.
            const genesis = new CryptoBlock(0, "", 0);
            await this.model.create(genesis);
            this.blockchain = [asPlainBlock(genesis)];
        } else {
            this.blockchain = saved.map(asPlainBlock);
            if (!this.checkChainValidity()) {
                throw new Error("Stored blockchain is invalid or incompatible with the required nonce/hash format. Back up the database and use a fresh database if necessary.");
            }
        }
    }

    obtainLatestBlock() {
        return this.blockchain[this.blockchain.length - 1];
    }

    checkChainValidity() {
        if (!this.blockchain.length) return false;
        try {
            for (let index = 0; index < this.blockchain.length; index += 1) {
                const current = asPlainBlock(this.blockchain[index]);
                if (current.hash !== computeHash(current)) return false;
                if (index === 0) {
                    const genesis = new CryptoBlock(0, "", 0);
                    if (current.hash !== genesis.hash || current.timestamp !== 0 ||
                        current.data !== 0 || current.previousHash !== "" || current.nonce !== 0) return false;
                } else {
                    const previous = this.blockchain[index - 1];
                    if (current.previousHash !== previous.hash ||
                        !current.hash.startsWith("0".repeat(this.difficulty))) return false;
                }
            }
            return true;
        } catch {
            return false;
        }
    }

    // Serialize writes so simultaneous measurements do not mine the same chain tip.
    enqueue(action) {
        const operation = this.writeQueue.then(action);
        this.writeQueue = operation.catch(() => {});
        return operation;
    }

    async addNewBlock(newBlock) {
        return this.enqueue(async () => {
            if (!this.checkChainValidity()) throw new Error("Blockchain is invalid");
            const data = typeof newBlock === "number" ? newBlock : newBlock.data;
            if (typeof data !== "number" || !Number.isFinite(data)) {
                throw new TypeError("Measurement must be a finite number");
            }
            const block = new CryptoBlock(data, this.obtainLatestBlock().hash);
            await block.proofOfWorkAsync(this.difficulty);
            // Persist before advertising a block to other peers.
            await this.model.create(block);
            const plain = asPlainBlock(block);
            this.blockchain.push(plain);
            return plain;
        });
    }

    async acceptRemoteBlock(rawBlock) {
        return this.enqueue(async () => {
            const block = asPlainBlock(rawBlock);
            if (this.blockchain.some((existing) => existing.hash === block.hash)) {
                return false; // Idempotency for repeated Socket.IO notifications.
            }
            if (!this.checkChainValidity() ||
                block.previousHash !== this.obtainLatestBlock().hash ||
                block.hash !== computeHash(block) ||
                !block.hash.startsWith("0".repeat(this.difficulty))) {
                throw new Error("Remote block failed proof-of-work or chain-link validation");
            }
            await this.model.create(block);
            this.blockchain.push(block);
            return true;
        });
    }
}

module.exports = { CryptoBlock, CryptoBlockchain, computeHash, asPlainBlock };
