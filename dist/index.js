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
exports.sendMessage = sendMessage;
const crypto = __importStar(require("crypto"));
const mobile_chain_1 = require("./core/mobile-chain");
const spore_mesh_1 = require("./core/spore-mesh");
const baseline_monitor_1 = require("./core/baseline-monitor");
const geo_cache_1 = require("./core/geo-cache");
const crypto_identity_1 = require("./core/crypto-identity");
const inbox_1 = require("./core/inbox");
const message_geo_1 = require("./core/message-geo");
// ─── Config from env or defaults ─────────────────────────────────────────────
const BRAIN_URL = process.env.BRAIN_URL ?? "http://5.78.193.141:41739";
const MESH_PORT = parseInt(process.env.MESH_PORT ?? "41740", 10);
const GEO_DIR = process.env.GEO_DIR ?? "./geo-cache";
const IDENTITY_PATH = process.env.IDENTITY_PATH ?? "./spore-identity.json";
const GROUP_KEYS_ENV = (process.env.GROUP_KEYS ?? "").split(",").filter(Boolean);
const EXTRA_PEERS = (process.env.PEERS ?? "").split(",").filter(Boolean); // "host:port,host:port"
console.log("╔═══════════════════════════════════════╗");
console.log("║     Shovelcat Spore Node  v0.1.0      ║");
console.log("╚═══════════════════════════════════════╝");
console.log(`[spore] Brain: ${BRAIN_URL}`);
console.log(`[spore] Mesh port: ${MESH_PORT}`);
console.log(`[spore] Geo dir: ${GEO_DIR}`);
// ─── Load / create node identity ──────────────────────────────────────────────
let identity;
try {
    identity = (0, crypto_identity_1.loadOrCreateIdentity)(IDENTITY_PATH);
    const words = (0, crypto_identity_1.nodeIdToWords)(identity.nodeId) ?? "(no word address)";
    console.log(`[spore] Node ID:  ${identity.nodeId}`);
    console.log(`[spore] Address:  ${words}`);
}
catch (err) {
    console.error("[spore] Failed to load identity:", err);
    process.exit(1);
}
// ─── Initialize geo dir ───────────────────────────────────────────────────────
(0, geo_cache_1.setGeoDir)(GEO_DIR);
// ─── Start subsystems ─────────────────────────────────────────────────────────
const chain = (0, mobile_chain_1.startMobileChain)();
const mesh = (0, spore_mesh_1.startSporeMesh)({ port: MESH_PORT, brainUrl: BRAIN_URL, geoDir: GEO_DIR });
const monitor = (0, baseline_monitor_1.startBaselineMonitor)(BRAIN_URL);
// ─── Start inbox ──────────────────────────────────────────────────────────────
const inbox = (0, inbox_1.startInbox)({
    identity,
    geoDir: GEO_DIR,
    groupKeys: GROUP_KEYS_ENV,
    onMessage(msg) {
        const words = msg.fromWords ?? msg.from.slice(0, 12);
        const flagStr = msg.flagScore.toFixed(1);
        const label = msg.payloadType === "direct" ? "DM"
            : msg.payloadType === "group" ? "GROUP"
                : "BROADCAST";
        console.log(`[inbox] NEW [${label}] from ${words} | flagScore=${flagStr} | decrypted=${msg.decrypted}`);
        if (msg.decrypted && msg.body) {
            const preview = msg.body.length > 80 ? msg.body.slice(0, 80) + "…" : msg.body;
            console.log(`[inbox]   > ${preview}`);
        }
    },
    pollIntervalMs: 10000,
});
console.log("[spore] Inbox started (polling every 10s)");
// Add any manually configured peers
for (const peer of EXTRA_PEERS) {
    const [host, portStr] = peer.split(":");
    if (host && portStr) {
        mesh.addPeer(host, parseInt(portStr, 10));
        console.log(`[spore] Added peer: ${host}:${portStr}`);
    }
}
// ─── Initial budget check ─────────────────────────────────────────────────────
const initialBudget = chain.getBudget();
console.log(`[spore] Resource budget: ${initialBudget.reason}`);
if (initialBudget.dormant) {
    console.warn("[spore] ⚠️  Starting in DORMANT mode — resources critically low");
}
// ─── Status log every 60s ─────────────────────────────────────────────────────
const statusInterval = setInterval(() => {
    const budget = chain.getBudget();
    const peers = mesh.getPeers();
    const cache = (0, geo_cache_1.getStats)();
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[spore] ${ts} | dormant=${budget.dormant} ceiling=${(budget.ceiling * 100).toFixed(0)}%` +
        ` | peers=${peers.length} | geos=${cache.count} | connected=${monitor.isConnected()}`);
    if (budget.dormant) {
        console.log(`[spore] Dormant reason: ${budget.reason}`);
    }
}, 60000);
// ─── sendMessage ─────────────────────────────────────────────────────────────
/**
 * Create a message geo and drop it in geoDir — the mesh will propagate it.
 * @param to  nodeId, "#word-word-word" (group), or "scope:global" (broadcast)
 * @param body  plaintext message body
 * @param type  "direct" | "group" | "broadcast"
 * @param opts  extra options: toPublicKey (RSA enc key for direct), groupKeyHex + groupWords + scope (group), scope (broadcast)
 */
function sendMessage(to, body, type, opts = {}) {
    const fromWords = (0, crypto_identity_1.nodeIdToWords)(identity.nodeId);
    let geoContent;
    if (type === "direct") {
        if (!opts.toPublicKey)
            throw new Error("sendMessage direct requires opts.toPublicKey (RSA enc key)");
        geoContent = (0, message_geo_1.createDirectMessage)({
            to, toPublicKey: opts.toPublicKey,
            from: identity.nodeId, fromWords, body, identity,
        });
    }
    else if (type === "group") {
        if (!opts.groupKeyHex || !opts.groupWords)
            throw new Error("sendMessage group requires opts.groupKeyHex + opts.groupWords");
        geoContent = (0, message_geo_1.createGroupMessage)({
            groupKeyHex: opts.groupKeyHex, groupWords: opts.groupWords,
            from: identity.nodeId, fromWords, body,
            scope: opts.scope ?? "global", identity,
        });
    }
    else {
        geoContent = (0, message_geo_1.createBroadcast)({
            from: identity.nodeId, fromWords, body,
            scope: opts.scope ?? "global", identity,
        });
    }
    const filename = `msg-${crypto.randomBytes(8).toString("hex")}-${Date.now()}.geo`;
    (0, geo_cache_1.writeGeo)(filename, Buffer.from(geoContent, "binary"));
    console.log(`[inbox] SENT [${type}] → ${to} | file=${filename}`);
}
// ─── Graceful shutdown ────────────────────────────────────────────────────────
function shutdown() {
    console.log("\n[spore] Shutting down...");
    clearInterval(statusInterval);
    chain.stop();
    mesh.stop();
    monitor.stop();
    inbox.stop();
    console.log("[spore] Goodbye 🐟");
    process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (err) => {
    console.error("[spore] Uncaught exception:", err.message);
    // Don't crash — just log. Spore nodes should stay up.
});
process.on("unhandledRejection", (reason) => {
    console.error("[spore] Unhandled rejection:", reason);
});
console.log("[spore] All subsystems started. Running...\n");
