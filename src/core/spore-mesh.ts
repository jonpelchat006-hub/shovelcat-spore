/**
 * spore-mesh.ts — Mesh connectivity for the spore node
 * Standalone implementation: no imports from colony codebase
 * Compatible with mesh-sync.ts protocol (port 41740, same endpoints)
 */
import * as http from "http";
import * as dgram from "dgram";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import { listGeos, hasGeo, writeGeo, readGeo, setGeoDir } from "./geo-cache";
import type { InboxMessage } from "./inbox";

const MDNS_ADDR = "224.0.0.251";
const MDNS_PORT = 5353;
const ANNOUNCE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const SYNC_INTERVAL = 10 * 60 * 1000;    // 10 minutes
const IDENTITY_FILE = "./spore-identity.json";

interface NodeIdentity {
  nodeId: string;
  hostname: string;
  seed: string;
  createdAt: string;
}

interface Peer {
  nodeId: string;
  host: string;
  port: number;
  lastSeen: number;
}

interface MeshGeoEntry {
  filename: string;
  hash: string;
  updatedAt: string;
}

// ─── Module-level registry for inbox/send access from HTTP layer ───────────────
let _inboxGetter: (() => InboxMessage[]) | null = null;
let _messageSender: ((to: string, body: string, type: "direct" | "group" | "broadcast", opts?: {
  toPublicKey?: string;
  groupKeyHex?: string;
  groupWords?: string;
  scope?: string;
}) => void) | null = null;

export function registerInboxGetter(fn: () => InboxMessage[]): void {
  _inboxGetter = fn;
}

export function registerMessageSender(fn: (
  to: string,
  body: string,
  type: "direct" | "group" | "broadcast",
  opts?: { toPublicKey?: string; groupKeyHex?: string; groupWords?: string; scope?: string }
) => void): void {
  _messageSender = fn;
}

export interface SporeMeshOptions {
  port?: number;
  brainUrl?: string;
  geoDir?: string;
}

export interface SporeMesh {
  stop: () => void;
  addPeer: (host: string, port: number) => void;
  getPeers: () => Peer[];
  syncNow: () => Promise<void>;
}

function loadOrCreateIdentity(): NodeIdentity {
  if (fs.existsSync(IDENTITY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(IDENTITY_FILE, "utf8"));
    } catch { /* fall through */ }
  }
  const seed = crypto.randomBytes(16).toString("hex");
  const hostname = os.hostname();
  const nodeId = crypto
    .createHash("sha256")
    .update(hostname + seed)
    .digest("hex");
  const identity: NodeIdentity = { nodeId, hostname, seed, createdAt: new Date().toISOString() };
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2));
  return identity;
}

function postJson(url: string, body: object): Promise<void> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const data = JSON.stringify(body);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parseInt(parsed.port || "80", 10),
          path: parsed.pathname,
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
        },
        (res) => {
          res.resume();
          resolve();
        }
      );
      req.on("error", () => resolve());
      req.setTimeout(5000, () => { req.destroy(); resolve(); });
      req.write(data);
      req.end();
    } catch {
      resolve();
    }
  });
}

function getJson<T>(url: string): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parseInt(parsed.port || "80", 10),
          path: parsed.pathname,
          method: "GET",
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
            } catch {
              resolve(null);
            }
          });
        }
      );
      req.on("error", () => resolve(null));
      req.setTimeout(10000, () => { req.destroy(); resolve(null); });
      req.end();
    } catch {
      resolve(null);
    }
  });
}

function getRaw(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parseInt(parsed.port || "80", 10),
          path: parsed.pathname,
          method: "GET",
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks)));
        }
      );
      req.on("error", () => resolve(null));
      req.setTimeout(15000, () => { req.destroy(); resolve(null); });
      req.end();
    } catch {
      resolve(null);
    }
  });
}

export function startSporeMesh(options: SporeMeshOptions = {}): SporeMesh {
  const port = options.port ?? 41740;
  const brainUrl = options.brainUrl ?? "http://5.78.193.141:41739";
  const geoDir = options.geoDir ?? "./geo-cache";

  setGeoDir(geoDir);

  const identity = loadOrCreateIdentity();
  const peers = new Map<string, Peer>();
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
        geoCount: listGeos().length,
        uptime: process.uptime(),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status));
      return;
    }

    if (url === "/mesh/geos") {
      const geos = listGeos().map((g) => ({
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
      if (hasGeo(filename)) {
        const content = readGeo(filename);
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(content);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    if (url === "/mesh/sync" && req.method === "POST") {
      syncWithPeers().catch(() => {});
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, triggered: true }));
      return;
    }

    if (url === "/mesh/inbox" && req.method === "GET") {
      const messages = _inboxGetter ? _inboxGetter() : [];
      // Strip rawGeo to keep response lean
      const lean = messages.map(({ rawGeo: _r, ...m }) => m);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(lean));
      return;
    }

    if (url === "/mesh/send" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          const { to, body: msgBody, type, toPublicKey, groupKeyHex, groupWords, scope } = data;
          if (!msgBody || !type) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "body and type required" }));
            return;
          }
          if (_messageSender) {
            _messageSender(to ?? "broadcast", msgBody, type, { toPublicKey, groupKeyHex, groupWords, scope });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "sender not registered" }));
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }

    if (url === "/mesh/peers" && req.method === "GET") {
      const peerList = Array.from(peers.values()).map(p => ({
        nodeId: p.nodeId,
        host: p.host,
        port: p.port,
        domains: [],
        geoCount: 0,
        lastSeen: new Date(p.lastSeen).toISOString(),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(peerList));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(port, () => {
    console.log(`[spore-mesh] HTTP server listening on :${port}`);
  });

  // --- Brain Registration ---
  async function announceToRain(): Promise<void> {
    await postJson(`${brainUrl}/nodes/announce`, {
      nodeId: identity.nodeId,
      hostname: identity.hostname,
      port,
      type: "spore",
      geoCount: listGeos().length,
      timestamp: new Date().toISOString(),
    });
  }

  const announceInterval = setInterval(() => {
    if (!stopped) announceToRain().catch(() => {});
  }, ANNOUNCE_INTERVAL);
  announceToRain().catch(() => {});

  // --- mDNS Discovery ---
  const mdns = dgram.createSocket({ type: "udp4", reuseAddr: true });
  mdns.bind(MDNS_PORT, () => {
    try {
      mdns.addMembership(MDNS_ADDR);
      mdns.setMulticastTTL(255);
    } catch { /* may fail on some platforms */ }
  });

  mdns.on("message", (msg: Buffer) => {
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
    } catch { /* ignore non-JSON */ }
  });

  // Broadcast own presence every 60s
  const mdnsBroadcastInterval = setInterval(() => {
    if (stopped) return;
    const msg = JSON.stringify({
      type: "shovelcat-spore",
      nodeId: identity.nodeId,
      hostname: identity.hostname,
      host: getLocalIp(),
      port,
    });
    const buf = Buffer.from(msg);
    mdns.send(buf, 0, buf.length, MDNS_PORT, MDNS_ADDR, () => {});
  }, 60_000);

  // --- Peer Sync ---
  async function syncWithPeer(peer: Peer): Promise<void> {
    const peerUrl = `http://${peer.host}:${peer.port}`;
    const remoteGeos = await getJson<MeshGeoEntry[]>(`${peerUrl}/mesh/geos`);
    if (!remoteGeos) return;

    const local = new Map(listGeos().map((g) => [g.filename, g.hash]));

    for (const remote of remoteGeos) {
      const localHash = local.get(remote.filename);
      if (!localHash || localHash !== remote.hash) {
        const content = await getRaw(`${peerUrl}/mesh/geo/${encodeURIComponent(remote.filename)}`);
        if (content) {
          writeGeo(remote.filename, content);
          console.log(`[spore-mesh] synced ${remote.filename} from ${peer.host}`);
        }
      }
    }
  }

  async function syncWithPeers(): Promise<void> {
    const activePeers = Array.from(peers.values()).filter(
      (p) => Date.now() - p.lastSeen < 10 * 60 * 1000
    );
    for (const peer of activePeers) {
      await syncWithPeer(peer).catch(() => {});
    }
  }

  const syncInterval = setInterval(() => {
    if (!stopped) syncWithPeers().catch(() => {});
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
    addPeer: (host: string, peerPort: number) => {
      const nodeId = crypto.createHash("sha256").update(`${host}:${peerPort}`).digest("hex").slice(0, 16);
      peers.set(nodeId, { nodeId, host, port: peerPort, lastSeen: Date.now() });
    },
    getPeers: () => Array.from(peers.values()),
    syncNow: syncWithPeers,
  };
}

function getLocalIp(): string {
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
