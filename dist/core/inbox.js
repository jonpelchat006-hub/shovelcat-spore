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
exports.startInbox = startInbox;
/**
 * inbox.ts — Polls geo dir for incoming messages and manages the local inbox
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_identity_1 = require("./crypto-identity");
const message_geo_1 = require("./message-geo");
function startInbox(opts) {
    const { identity, geoDir, onMessage, pollIntervalMs = 10000, } = opts;
    const groupKeys = [...opts.groupKeys];
    const seen = new Set();
    const inbox = [];
    let stopped = false;
    let timer = null;
    // ── scan once ──────────────────────────────────────────────────────────────
    function scan() {
        if (stopped)
            return;
        let files;
        try {
            files = fs.readdirSync(geoDir).filter(f => f.endsWith('.geo'));
        }
        catch {
            scheduleNext();
            return;
        }
        // Collect flag geos for trust scoring
        const flagGeos = [];
        for (const filename of files) {
            try {
                const raw = readGeoAsString(path.join(geoDir, filename));
                const hdr = Buffer.from(raw, 'binary').slice(0, 4).toString();
                if (hdr !== 'GEO\x00')
                    continue;
                if ((0, message_geo_1.parseFlag)(raw))
                    flagGeos.push(raw);
            }
            catch { /* skip bad files */ }
        }
        for (const filename of files) {
            if (seen.has(filename))
                continue;
            try {
                const raw = readGeoAsString(path.join(geoDir, filename));
                const msg = (0, message_geo_1.parseMessage)(raw);
                if (!msg)
                    continue; // not a message geo
                seen.add(filename);
                const flagScore = (0, message_geo_1.getTrustTemperature)(msg.from, flagGeos);
                let body = null;
                let decrypted = false;
                // ── Direct ──────────────────────────────────────────────────────────
                if (msg.payloadType === 'direct' && msg.to === identity.nodeId) {
                    try {
                        body = (0, crypto_identity_1.decryptFromSender)(msg.rawEncrypted, identity.encPrivateKey);
                        decrypted = true;
                    }
                    catch { /* wrong key or not for us */ }
                    // ── Group ────────────────────────────────────────────────────────────
                }
                else if (msg.payloadType === 'group' && msg.to.startsWith('#')) {
                    for (const key of groupKeys) {
                        if (msg.groupKeyHint && !key.startsWith(msg.groupKeyHint))
                            continue;
                        try {
                            body = (0, crypto_identity_1.decryptGroup)(msg.rawEncrypted, key);
                            decrypted = true;
                            break;
                        }
                        catch { /* wrong key, try next */ }
                    }
                    // ── Broadcast ────────────────────────────────────────────────────────
                }
                else if (msg.payloadType === 'broadcast' && msg.to.startsWith('scope:')) {
                    try {
                        body = Buffer.from(msg.rawEncrypted, 'base64').toString('utf8');
                        decrypted = true;
                    }
                    catch { /* corrupt broadcast */ }
                }
                else {
                    // Not addressed to us — still track it as seen but don't emit
                    continue;
                }
                const inboxMsg = {
                    filename,
                    from: msg.from,
                    fromWords: msg.fromWords,
                    payloadType: msg.payloadType,
                    body,
                    decrypted,
                    sentAt: msg.sentAt,
                    flagScore,
                    rawGeo: raw,
                };
                inbox.push(inboxMsg);
                try {
                    onMessage(inboxMsg);
                }
                catch { /* caller error, don't crash */ }
            }
            catch { /* malformed geo, skip */ }
        }
        scheduleNext();
    }
    function scheduleNext() {
        if (stopped)
            return;
        timer = setTimeout(scan, pollIntervalMs);
    }
    // Start immediately
    scan();
    return {
        stop() {
            stopped = true;
            if (timer)
                clearTimeout(timer);
        },
        getMessages() {
            return [...inbox];
        },
        addGroupKey(hex) {
            if (!groupKeys.includes(hex))
                groupKeys.push(hex);
        },
    };
}
// ── Helper: read geo file as binary string ─────────────────────────────────
function readGeoAsString(filepath) {
    return fs.readFileSync(filepath).toString('binary');
}
