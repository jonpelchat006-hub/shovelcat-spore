"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDirectMessage = createDirectMessage;
exports.createGroupMessage = createGroupMessage;
exports.createBroadcast = createBroadcast;
exports.parseMessage = parseMessage;
exports.createFlag = createFlag;
exports.parseFlag = parseFlag;
exports.getTrustTemperature = getTrustTemperature;
const crypto_identity_1 = require("./crypto-identity");
// ── GEO header ────────────────────────────────────────────────────────────────
const GEO_HEADER = Buffer.from('GEO\x00');
function makeGeo(payload) {
    return Buffer.concat([GEO_HEADER, Buffer.from(JSON.stringify(payload))]).toString('binary');
}
function parseGeo(geoContent) {
    try {
        const buf = Buffer.from(geoContent, 'binary');
        if (buf.slice(0, 4).toString() !== 'GEO\x00')
            return null;
        return JSON.parse(buf.slice(4).toString('utf8'));
    }
    catch {
        return null;
    }
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function buildGeoIdentity(nodeId) {
    return { nodeId, version: '1.0', createdAt: new Date().toISOString() };
}
function sigPayload(to, from, encryptedPayload, sentAt) {
    return to + from + encryptedPayload + sentAt;
}
// ── createDirectMessage ───────────────────────────────────────────────────────
function createDirectMessage(opts) {
    const sentAt = new Date().toISOString();
    const encryptedPayload = (0, crypto_identity_1.encryptForRecipient)(opts.body, opts.toPublicKey);
    const sig = (0, crypto_identity_1.signMessage)(sigPayload(opts.to, opts.from, encryptedPayload, sentAt), opts.identity.privateKey);
    return makeGeo({
        identity: buildGeoIdentity(opts.from),
        extensions: {
            message: {
                to: opts.to,
                from: opts.from,
                fromWords: opts.fromWords,
                encryptedPayload,
                payloadType: 'direct',
                groupKeyHint: null,
                signature: sig,
                sentAt,
                ttl: 86400,
                flagScore: 0,
            },
        },
    });
}
// ── createGroupMessage ────────────────────────────────────────────────────────
function createGroupMessage(opts) {
    const sentAt = new Date().toISOString();
    const to = '#' + opts.groupWords.replace(/\s+/g, '-');
    const encryptedPayload = (0, crypto_identity_1.encryptGroup)(opts.body, opts.groupKeyHex);
    const hint = opts.groupKeyHex.slice(0, 8);
    const sig = (0, crypto_identity_1.signMessage)(sigPayload(to, opts.from, encryptedPayload, sentAt), opts.identity.privateKey);
    return makeGeo({
        identity: buildGeoIdentity(opts.from),
        extensions: {
            message: {
                to,
                from: opts.from,
                fromWords: opts.fromWords,
                encryptedPayload,
                payloadType: 'group',
                groupKeyHint: hint,
                signature: sig,
                sentAt,
                ttl: 86400,
                flagScore: 0,
            },
        },
    });
}
// ── createBroadcast ───────────────────────────────────────────────────────────
function createBroadcast(opts) {
    const sentAt = new Date().toISOString();
    const to = 'scope:' + opts.scope;
    // Broadcast body is base64-encoded plaintext (no encryption)
    const encryptedPayload = Buffer.from(opts.body, 'utf8').toString('base64');
    const sig = (0, crypto_identity_1.signMessage)(sigPayload(to, opts.from, encryptedPayload, sentAt), opts.identity.privateKey);
    return makeGeo({
        identity: buildGeoIdentity(opts.from),
        extensions: {
            message: {
                to,
                from: opts.from,
                fromWords: opts.fromWords,
                encryptedPayload,
                payloadType: 'broadcast',
                groupKeyHint: null,
                signature: sig,
                sentAt,
                ttl: 86400,
                flagScore: 0,
            },
        },
    });
}
// ── parseMessage ──────────────────────────────────────────────────────────────
function parseMessage(geoContent) {
    const parsed = parseGeo(geoContent);
    if (!parsed)
        return null;
    const msg = parsed?.extensions?.message;
    if (!msg)
        return null;
    if (typeof msg.to !== 'string' || typeof msg.from !== 'string' ||
        typeof msg.encryptedPayload !== 'string' || typeof msg.signature !== 'string' ||
        typeof msg.sentAt !== 'string' || typeof msg.payloadType !== 'string')
        return null;
    return {
        to: msg.to,
        from: msg.from,
        fromWords: typeof msg.fromWords === 'string' ? msg.fromWords : null,
        payloadType: msg.payloadType,
        groupKeyHint: typeof msg.groupKeyHint === 'string' ? msg.groupKeyHint : null,
        signature: msg.signature,
        sentAt: msg.sentAt,
        ttl: typeof msg.ttl === 'number' ? msg.ttl : 86400,
        rawEncrypted: msg.encryptedPayload,
    };
}
// ── createFlag ────────────────────────────────────────────────────────────────
function createFlag(opts) {
    const at = new Date().toISOString();
    const sig = (0, crypto_identity_1.signMessage)(opts.target + opts.reason + opts.flaggedBy + at, opts.identity.privateKey);
    return makeGeo({
        identity: buildGeoIdentity(opts.flaggedBy),
        extensions: {
            flag: {
                target: opts.target,
                reason: opts.reason,
                flaggedBy: opts.flaggedBy,
                at,
                signature: sig,
            },
        },
    });
}
// ── parseFlag ─────────────────────────────────────────────────────────────────
function parseFlag(geoContent) {
    const parsed = parseGeo(geoContent);
    if (!parsed)
        return null;
    const flag = parsed?.extensions?.flag;
    if (!flag)
        return null;
    if (typeof flag.target !== 'string' || typeof flag.reason !== 'string' ||
        typeof flag.flaggedBy !== 'string' || typeof flag.at !== 'string' ||
        typeof flag.signature !== 'string')
        return null;
    return {
        target: flag.target,
        reason: flag.reason,
        flaggedBy: flag.flaggedBy,
        at: flag.at,
        signature: flag.signature,
    };
}
// ── Trust temperature ─────────────────────────────────────────────────────────
// 0.0 = cold (trusted), 1.0 = hot (flagged)
function getTrustTemperature(nodeId, flagGeos) {
    const now = Date.now();
    const DAY_MS = 86400000;
    let score = 0;
    for (const geo of flagGeos) {
        const flag = parseFlag(geo);
        if (!flag || flag.target !== nodeId)
            continue;
        const age = now - new Date(flag.at).getTime();
        const days = age / DAY_MS;
        // Exponential decay: full weight < 1 day, half weight at 7 days
        const weight = Math.exp(-days * Math.LN2 / 7);
        score += weight;
    }
    // Clamp to 0-1: cap = 5 flags → full heat
    return Math.min(1, score / 5);
}
