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
exports.startSporeMesh = startSporeMesh;
/**
 * spore-mesh.ts — Mesh connectivity for the spore node
 * Standalone implementation: no imports from colony codebase
 * Compatible with mesh-sync.ts protocol (port 41740, same endpoints)
 */
const http = __importStar(require("http"));
const dgram = __importStar(require("dgram"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const geo_cache_1 = require("./geo-cache");
const MDNS_ADDR = "224.0.0.251";
const MDNS_PORT = 5353;
const ANNOUNCE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const SYNC_INTERVAL = 10 * 60 * 1000; // 10 minutes
const IDENTITY_FILE = "./spore-identity.json";
function loadOrCreateIdentity() {
    if (fs.existsSync(IDENTITY_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(IDENTITY_FILE, "utf8"));
        }
        catch { /* fall through */ }
    }
    const seed = crypto.randomBytes(16).toString("hex");
    const hostname = os.hostname();
    const nodeId = crypto
        .createHash("sha256")
        .update(hostname + seed)
        .digest("hex");
    const identity = { nodeId, hostname, seed, createdAt: new Date().toISOString() };
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2));
    return identity;
}
function postJson(url, body) {
    return new Promise((resolve) => {
        try {
            const parsed = new URL(url);
            const data = JSON.stringify(body);
            const req = http.request({
                hostname: parsed.hostname,
                port: parseInt(parsed.port || "80", 10),
                path: parsed.pathname,
                method: "POST",
                headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
            }, (res) => {
                res.resume();
                resolve();
            });
            req.on("error", () => resolve());
            req.setTimeout(5000, () => { req.destroy(); resolve(); });
            req.write(data);
            req.end();
        }
        catch {
            resolve();
        }
    });
}
function getJson(url) {
    return new Promise((resolve) => {
        try {
            const parsed = new URL(url);
            const req = http.request({
                hostname: parsed.hostname,
                port: parseInt(parsed.port || "80", 10),
                path: parsed.pathname,
                method: "GET",
            }, (res) => {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                    }
                    catch {
                        resolve(null);
                    }
                });
            });
            req.on("error", () => resolve(null));
            req.setTimeout(10000, () => { req.destroy(); resolve(null); });
            req.end();
        }
        catch {
            resolve(null);
        }
    });
}
function getRaw(url) {
    return new Promise((resolve) => {
        try {
            const parsed = new URL(url);
            const req = http.request({
                hostname: parsed.hostname,
                port: parseInt(parsed.port || "80", 10),
                path: parsed.pathname,
                method: "GET",
            }, (res) => {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => resolve(Buffer.concat(chunks)));
            });
            req.on("error", () => resolve(null));
            req.setTimeout(15000, () => { req.destroy(); resolve(null); });
            req.end();
        }
        catch {
            resolve(null);
        }
    });
}
function startSporeMesh(options = {}) {
    const port = options.port ?? 41740;
    const brainUrl = options.brainUrl ?? "http://5.78.193.141:41739";
    const geoDir = options.geoDir ?? "./geo-cache";
    (0, geo_cache_1.setGeoDir)(geoDir);
    const identity = loadOrCreateIdentity();
    const peers = new Map();
    let stopped = false;
    // --- HTTP Server ---
    const server = http.createServer((req, res) => {
        const url = req.url ?? "/";
        if (url === "/mesh/status") {
            const status = {
                nodeId: identity.nodeId,
                hostname: identity.hostname,
                port,
                peers: Array.from(peers.values()),
                geoCount: (0, geo_cache_1.listGeos)().length,
                uptime: process.uptime(),
            };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(status));
            return;
        }
        if (url === "/mesh/geos") {
            const geos = (0, geo_cache_1.listGeos)().map((g) => ({
                filename: g.filename,
                hash: g.hash,
                updatedAt: g.updatedAt.toISOString(),
            }));
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(geos));
            return;
        }
        const geoMatch = url.match(/^\/mesh\/geo\/(.+)$/);
        if (geoMatch) {
            const filename = decodeURIComponent(geoMatch[1]);
            if ((0, geo_cache_1.hasGeo)(filename)) {
                const content = (0, geo_cache_1.readGeo)(filename);
                res.writeHead(200, { "Content-Type": "application/octet-stream" });
                res.end(content);
            }
            else {
                res.writeHead(404);
                res.end("Not found");
            }
            return;
        }
        if (url === "/mesh/sync" && req.method === "POST") {
            syncWithPeers().catch(() => { });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, triggered: true }));
            return;
        }
        res.writeHead(404);
        res.end("Not found");
    });
    server.listen(port, () => {
        console.log(`[spore-mesh] HTTP server listening on :${port}`);
    });
    // --- Brain Registration ---
    async function announceToRain() {
        await postJson(`${brainUrl}/nodes/announce`, {
            nodeId: identity.nodeId,
            hostname: identity.hostname,
            port,
            type: "spore",
            geoCount: (0, geo_cache_1.listGeos)().length,
            timestamp: new Date().toISOString(),
        });
    }
    const announceInterval = setInterval(() => {
        if (!stopped)
            announceToRain().catch(() => { });
    }, ANNOUNCE_INTERVAL);
    announceToRain().catch(() => { });
    // --- mDNS Discovery ---
    const mdns = dgram.createSocket({ type: "udp4", reuseAddr: true });
    mdns.bind(MDNS_PORT, () => {
        try {
            mdns.addMembership(MDNS_ADDR);
            mdns.setMulticastTTL(255);
        }
        catch { /* may fail on some platforms */ }
    });
    mdns.on("message", (msg) => {
        try {
            const data = JSON.parse(msg.toString("utf8"));
            if (data?.type === "shovelcat-spore" && data?.nodeId && data?.nodeId !== identity.nodeId) {
                const key = data.nodeId;
                peers.set(key, {
                    nodeId: data.nodeId,
                    host: data.host,
                    port: data.port ?? 41740,
                    lastSeen: Date.now(),
                });
            }
        }
        catch { /* ignore non-JSON */ }
    });
    // Broadcast own presence every 60s
    const mdnsBroadcastInterval = setInterval(() => {
        if (stopped)
            return;
        const msg = JSON.stringify({
            type: "shovelcat-spore",
            nodeId: identity.nodeId,
            hostname: identity.hostname,
            host: getLocalIp(),
            port,
        });
        const buf = Buffer.from(msg);
        mdns.send(buf, 0, buf.length, MDNS_PORT, MDNS_ADDR, () => { });
    }, 60000);
    // --- Peer Sync ---
    async function syncWithPeer(peer) {
        const peerUrl = `http://${peer.host}:${peer.port}`;
        const remoteGeos = await getJson(`${peerUrl}/mesh/geos`);
        if (!remoteGeos)
            return;
        const local = new Map((0, geo_cache_1.listGeos)().map((g) => [g.filename, g.hash]));
        for (const remote of remoteGeos) {
            const localHash = local.get(remote.filename);
            if (!localHash || localHash !== remote.hash) {
                const content = await getRaw(`${peerUrl}/mesh/geo/${encodeURIComponent(remote.filename)}`);
                if (content) {
                    (0, geo_cache_1.writeGeo)(remote.filename, content);
                    console.log(`[spore-mesh] synced ${remote.filename} from ${peer.host}`);
                }
            }
        }
    }
    async function syncWithPeers() {
        const activePeers = Array.from(peers.values()).filter((p) => Date.now() - p.lastSeen < 10 * 60 * 1000);
        for (const peer of activePeers) {
            await syncWithPeer(peer).catch(() => { });
        }
    }
    const syncInterval = setInterval(() => {
        if (!stopped)
            syncWithPeers().catch(() => { });
    }, SYNC_INTERVAL);
    return {
        stop: () => {
            stopped = true;
            clearInterval(announceInterval);
            clearInterval(mdnsBroadcastInterval);
            clearInterval(syncInterval);
            mdns.close();
            server.close();
        },
        addPeer: (host, peerPort) => {
            const nodeId = crypto.createHash("sha256").update(`${host}:${peerPort}`).digest("hex").slice(0, 16);
            peers.set(nodeId, { nodeId, host, port: peerPort, lastSeen: Date.now() });
        },
        getPeers: () => Array.from(peers.values()),
        syncNow: syncWithPeers,
    };
}
function getLocalIp() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] ?? []) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1";
}
