"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORDS = void 0;
exports.loadOrCreateIdentity = loadOrCreateIdentity;
exports.signMessage = signMessage;
exports.verifySignature = verifySignature;
exports.encryptForRecipient = encryptForRecipient;
exports.decryptFromSender = decryptFromSender;
exports.generateGroupKey = generateGroupKey;
exports.encryptGroup = encryptGroup;
exports.decryptGroup = decryptGroup;
exports.wordsToNodeId = wordsToNodeId;
exports.nodeIdToWords = nodeIdToWords;
exports.registerWords = registerWords;
/**
 * crypto-identity.ts — Keypair generation and message crypto for spore nodes
 * Uses ONLY Node.js built-in crypto module. Zero npm runtime dependencies.
 */
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ── 256-word list (word[byte] → 256³ = 16.7M combinations) ──────────────────
exports.WORDS = [
    'river', 'falcon', 'stone', 'amber', 'bright', 'cloud', 'delta', 'echo', 'frost', 'golden',
    'harbor', 'iron', 'jade', 'kelp', 'lunar', 'marsh', 'nova', 'ocean', 'pine', 'quartz',
    'reef', 'silver', 'tide', 'ultra', 'violet', 'wave', 'xenon', 'yellow', 'zinc', 'alpine',
    'basin', 'cedar', 'drift', 'ember', 'fjord', 'grove', 'haven', 'inlet', 'jasper', 'kestrel',
    'lagoon', 'maple', 'night', 'orbit', 'patrol', 'quill', 'raven', 'storm', 'tundra', 'uplift',
    'vortex', 'willow', 'xray', 'yarrow', 'zenith', 'anchor', 'blaze', 'coral', 'dusk', 'eagle',
    'flint', 'granite', 'hawk', 'island', 'jungle', 'kite', 'lance', 'meadow', 'noble', 'opal',
    'prism', 'quarry', 'robin', 'sage', 'thunder', 'umber', 'vale', 'warren', 'xerus', 'yonder',
    'zephyr', 'arctic', 'brook', 'canyon', 'dawn', 'elder', 'fern', 'glacier', 'holly', 'ivy',
    'juniper', 'kaolin', 'larch', 'mire', 'nectar', 'onyx', 'peak', 'quest', 'rush', 'slate',
    'terra', 'union', 'verdant', 'wolf', 'xylem', 'yew', 'zinc2', 'alder', 'birch', 'cobalt',
    'dune', 'elm', 'flax', 'gorse', 'heath', 'ire', 'jest', 'knoll', 'lime', 'moss',
    'nook', 'ore', 'peat', 'quake', 'reed', 'soil', 'thorn', 'ursa', 'vent', 'wren',
    'axis', 'bolt', 'cave', 'dell', 'etch', 'ford', 'gale', 'hull', 'isle', 'jolt',
    'keel', 'loft', 'mast', 'nave', 'oak', 'port', 'raft', 'silt', 'toll', 'urn',
    'volt', 'wake', 'yaw', 'abbot', 'baron', 'crane', 'dirk', 'earl', 'fife', 'guild',
    'hilt', 'jager', 'kern', 'lute', 'mace', 'nave2', 'orb', 'pike', 'rand', 'spur',
    'tarn', 'vale2', 'weld', 'yore', 'abbey', 'brae', 'croft', 'dale', 'firth', 'glen',
    'holm', 'inch', 'knap', 'linn', 'mere', 'ness', 'ouse', 'pool', 'rill', 'shaw',
    'toft', 'weir', 'beck', 'burn', 'carr', 'dike', 'fell', 'ghyll', 'hagg', 'ings',
    'keld', 'leat', 'moor', 'naab', 'oxbow', 'peel', 'rhos', 'sike', 'tor', 'uig',
    'voe', 'wick', 'yat', 'zawn', 'argh', 'bield', 'clough', 'dod', 'esk', 'force',
    'garth', 'hag', 'iver', 'joe', 'knott', 'lund',
    'ash', 'bay', 'cape', 'dew', 'eve', 'fog', 'gem', 'hay', 'ink', 'jar',
    'kin', 'log', 'mud', 'net', 'owl', 'pad', 'ram', 'rod', 'rye', 'sea',
    'sky', 'tan', 'van', 'web', 'zen', 'bud', 'cob', 'dam', 'elk', 'fig',
];
function derivePassphrase(nodeId) {
    return crypto.createHash('sha256').update('shovelcat:' + nodeId).digest('hex');
}
// ── Identity load/create ──────────────────────────────────────────────────────
function loadOrCreateIdentity(identityPath) {
    let data = {};
    if (fs.existsSync(identityPath)) {
        try {
            data = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
        }
        catch { /* fresh */ }
    }
    let changed = false;
    if (!data.nodeId) {
        data.nodeId = crypto.randomBytes(16).toString('hex');
        changed = true;
    }
    const nodeId = data.nodeId;
    const passphrase = derivePassphrase(nodeId);
    // Ed25519 signing keypair
    if (!data.publicKey || !data.privateKey) {
        const kp = crypto.generateKeyPairSync('ed25519', {
            publicKeyEncoding: { type: 'spki', format: 'der' },
            privateKeyEncoding: { type: 'pkcs8', format: 'der', cipher: 'aes-256-cbc', passphrase },
        });
        data.publicKey = kp.publicKey.toString('base64');
        data.privateKey = kp.privateKey.toString('base64');
        changed = true;
    }
    // RSA-2048 encryption keypair
    if (!data.encPublicKey || !data.encPrivateKey) {
        const kp = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'der' },
            privateKeyEncoding: { type: 'pkcs8', format: 'der', cipher: 'aes-256-cbc', passphrase },
        });
        data.encPublicKey = kp.publicKey.toString('base64');
        data.encPrivateKey = kp.privateKey.toString('base64');
        changed = true;
    }
    if (changed) {
        fs.mkdirSync(path.dirname(path.resolve(identityPath)), { recursive: true });
        fs.writeFileSync(identityPath, JSON.stringify(data, null, 2));
    }
    // Decrypt private keys → unencrypted DER for in-memory use (auto-unlocked via nodeId)
    const sigPrivKey = crypto.createPrivateKey({
        key: Buffer.from(data.privateKey, 'base64'),
        format: 'der', type: 'pkcs8', passphrase,
    });
    const encPrivKey = crypto.createPrivateKey({
        key: Buffer.from(data.encPrivateKey, 'base64'),
        format: 'der', type: 'pkcs8', passphrase,
    });
    return {
        nodeId,
        publicKey: data.publicKey,
        privateKey: sigPrivKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
        encPublicKey: data.encPublicKey,
        encPrivateKey: encPrivKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    };
}
// ── Ed25519 signing ───────────────────────────────────────────────────────────
function signMessage(content, privateKeyB64) {
    const key = crypto.createPrivateKey({ key: Buffer.from(privateKeyB64, 'base64'), format: 'der', type: 'pkcs8' });
    return crypto.sign(null, Buffer.from(content, 'utf8'), key).toString('base64');
}
function verifySignature(content, signature, publicKeyB64) {
    try {
        const key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
        return crypto.verify(null, Buffer.from(content, 'utf8'), key, Buffer.from(signature, 'base64'));
    }
    catch {
        return false;
    }
}
// ── RSA hybrid encryption (RSA-OAEP wraps AES-256-GCM key) ───────────────────
function encryptForRecipient(message, recipientEncPublicKeyB64) {
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const body = Buffer.concat([cipher.update(message, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const pubKey = crypto.createPublicKey({ key: Buffer.from(recipientEncPublicKeyB64, 'base64'), format: 'der', type: 'spki' });
    const wrappedKey = crypto.publicEncrypt({ key: pubKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, aesKey);
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32BE(wrappedKey.length, 0);
    return Buffer.concat([lenBuf, wrappedKey, iv, tag, body]).toString('base64');
}
function decryptFromSender(ciphertext, myEncPrivateKeyB64) {
    const buf = Buffer.from(ciphertext, 'base64');
    const keyLen = buf.readUInt32BE(0);
    const wrappedKey = buf.slice(4, 4 + keyLen);
    const iv = buf.slice(4 + keyLen, 4 + keyLen + 12);
    const tag = buf.slice(4 + keyLen + 12, 4 + keyLen + 28);
    const body = buf.slice(4 + keyLen + 28);
    const privKey = crypto.createPrivateKey({ key: Buffer.from(myEncPrivateKeyB64, 'base64'), format: 'der', type: 'pkcs8' });
    const aesKey = crypto.privateDecrypt({ key: privKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, wrappedKey);
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
// ── Group keys (AES-256-GCM) ──────────────────────────────────────────────────
function generateGroupKey() {
    const keyBytes = crypto.randomBytes(32);
    const wordBytes = crypto.randomBytes(3);
    const wordTriple = [exports.WORDS[wordBytes[0]], exports.WORDS[wordBytes[1]], exports.WORDS[wordBytes[2]]].join(' ');
    return { key: keyBytes.toString('hex'), words: wordTriple };
}
function encryptGroup(message, groupKeyHex) {
    const key = Buffer.from(groupKeyHex, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(message, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, body]).toString('base64');
}
function decryptGroup(ciphertext, groupKeyHex) {
    const key = Buffer.from(groupKeyHex, 'hex');
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const body = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
// ── Word registry (local ./word-registry.json) ────────────────────────────────
const REGISTRY_PATH = path.resolve('./word-registry.json');
function loadRegistry() {
    try {
        return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    }
    catch {
        return {};
    }
}
function saveRegistry(reg) {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
}
function wordsToNodeId(words) {
    const reg = loadRegistry();
    return reg[words]?.nodeId ?? null;
}
function nodeIdToWords(nodeId) {
    const reg = loadRegistry();
    const entry = Object.entries(reg).find(([, v]) => v.nodeId === nodeId);
    return entry ? entry[0] : null;
}
function registerWords(words, nodeId, publicKey, encPublicKey) {
    const reg = loadRegistry();
    reg[words] = { nodeId, publicKey, encPublicKey, registeredAt: new Date().toISOString() };
    saveRegistry(reg);
}
