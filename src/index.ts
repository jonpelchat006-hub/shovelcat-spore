/**
 * index.ts — Shovelcat Spore Node entry point
 * Wires all subsystems: mobile-chain, geo-cache, spore-mesh, baseline-monitor, inbox
 */
import * as path from "path";
import * as crypto from "crypto";
import { startMobileChain } from "./core/mobile-chain";
import { startSporeMesh, registerInboxGetter, registerMessageSender } from "./core/spore-mesh";
import { startBaselineMonitor } from "./core/baseline-monitor";
import { getStats, setGeoDir, writeGeo } from "./core/geo-cache";
import { loadOrCreateIdentity, nodeIdToWords } from "./core/crypto-identity";
import { startInbox } from "./core/inbox";
import {
  createDirectMessage, createGroupMessage, createBroadcast,
} from "./core/message-geo";
import type { SporeIdentity } from "./core/crypto-identity";

// ─── Config from env or defaults ─────────────────────────────────────────────
const BRAIN_URL      = process.env.BRAIN_URL ?? "http://5.78.193.141:41739";
const MESH_PORT      = parseInt(process.env.MESH_PORT ?? "41740", 10);
const GEO_DIR        = process.env.GEO_DIR ?? "./geo-cache";
const IDENTITY_PATH  = process.env.IDENTITY_PATH ?? "./spore-identity.json";
const GROUP_KEYS_ENV = (process.env.GROUP_KEYS ?? "").split(",").filter(Boolean);
const EXTRA_PEERS    = (process.env.PEERS ?? "").split(",").filter(Boolean); // "host:port,host:port"

console.log("╔═══════════════════════════════════════╗");
console.log("║     Shovelcat Spore Node  v0.1.0      ║");
console.log("╚═══════════════════════════════════════╝");
console.log(`[spore] Brain: ${BRAIN_URL}`);
console.log(`[spore] Mesh port: ${MESH_PORT}`);
console.log(`[spore] Geo dir: ${GEO_DIR}`);

// ─── Load / create node identity ──────────────────────────────────────────────
let identity: SporeIdentity;
try {
  identity = loadOrCreateIdentity(IDENTITY_PATH);
  const words = nodeIdToWords(identity.nodeId) ?? "(no word address)";
  console.log(`[spore] Node ID:  ${identity.nodeId}`);
  console.log(`[spore] Address:  ${words}`);
} catch (err) {
  console.error("[spore] Failed to load identity:", err);
  process.exit(1);
}

// ─── Initialize geo dir ───────────────────────────────────────────────────────
setGeoDir(GEO_DIR);

// ─── Start subsystems ─────────────────────────────────────────────────────────
const chain   = startMobileChain();
const mesh    = startSporeMesh({ port: MESH_PORT, brainUrl: BRAIN_URL, geoDir: GEO_DIR });
const monitor = startBaselineMonitor(BRAIN_URL);

// ─── Start inbox ──────────────────────────────────────────────────────────────
const inbox = startInbox({
  identity,
  geoDir: GEO_DIR,
  groupKeys: GROUP_KEYS_ENV,
  onMessage(msg) {
    const words     = msg.fromWords ?? msg.from.slice(0, 12);
    const flagStr   = msg.flagScore.toFixed(1);
    const label     = msg.payloadType === "direct" ? "DM"
                    : msg.payloadType === "group"  ? "GROUP"
                    : "BROADCAST";
    console.log(
      `[inbox] NEW [${label}] from ${words} | flagScore=${flagStr} | decrypted=${msg.decrypted}`
    );
    if (msg.decrypted && msg.body) {
      const preview = msg.body.length > 80 ? msg.body.slice(0, 80) + "…" : msg.body;
      console.log(`[inbox]   > ${preview}`);
    }
  },
  pollIntervalMs: 10_000,
});
console.log("[spore] Inbox started (polling every 10s)");

// Register inbox/send with the mesh HTTP layer
registerInboxGetter(() => inbox.getMessages());
registerMessageSender((to, body, type, opts) => sendMessage(to, body, type, opts));

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
  const cache = getStats();
  const ts = new Date().toISOString().slice(11, 19);
  console.log(
    `[spore] ${ts} | dormant=${budget.dormant} ceiling=${(budget.ceiling * 100).toFixed(0)}%` +
    ` | peers=${peers.length} | geos=${cache.count} | connected=${monitor.isConnected()}`
  );
  if (budget.dormant) {
    console.log(`[spore] Dormant reason: ${budget.reason}`);
  }
}, 60_000);

// ─── sendMessage ─────────────────────────────────────────────────────────────
/**
 * Create a message geo and drop it in geoDir — the mesh will propagate it.
 * @param to  nodeId, "#word-word-word" (group), or "scope:global" (broadcast)
 * @param body  plaintext message body
 * @param type  "direct" | "group" | "broadcast"
 * @param opts  extra options: toPublicKey (RSA enc key for direct), groupKeyHex + groupWords + scope (group), scope (broadcast)
 */
export function sendMessage(
  to: string,
  body: string,
  type: "direct" | "group" | "broadcast",
  opts: {
    toPublicKey?: string;
    groupKeyHex?: string;
    groupWords?:  string;
    scope?:       string;
  } = {}
): void {
  const fromWords = nodeIdToWords(identity.nodeId);
  let geoContent: string;

  if (type === "direct") {
    if (!opts.toPublicKey) throw new Error("sendMessage direct requires opts.toPublicKey (RSA enc key)");
    geoContent = createDirectMessage({
      to, toPublicKey: opts.toPublicKey,
      from: identity.nodeId, fromWords, body, identity,
    });
  } else if (type === "group") {
    if (!opts.groupKeyHex || !opts.groupWords) throw new Error("sendMessage group requires opts.groupKeyHex + opts.groupWords");
    geoContent = createGroupMessage({
      groupKeyHex: opts.groupKeyHex, groupWords: opts.groupWords,
      from: identity.nodeId, fromWords, body,
      scope: opts.scope ?? "global", identity,
    });
  } else {
    geoContent = createBroadcast({
      from: identity.nodeId, fromWords, body,
      scope: opts.scope ?? "global", identity,
    });
  }

  const filename = `msg-${crypto.randomBytes(8).toString("hex")}-${Date.now()}.geo`;
  writeGeo(filename, Buffer.from(geoContent, "binary"));
  console.log(`[inbox] SENT [${type}] → ${to} | file=${filename}`);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
function shutdown(): void {
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
