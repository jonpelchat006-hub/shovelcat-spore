/**
 * geo-cache.ts — Geo file manager for spore node
 * Handles the GEO\x00{json} format used by the Shovelcat colony
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// GEO format: 4-byte header "GEO\x00" followed by UTF-8 JSON
const GEO_HEADER = Buffer.from([0x47, 0x45, 0x4f, 0x00]); // "GEO\0"

let GEO_DIR = process.env.GEO_DIR ?? path.join(process.cwd(), "geo-cache");

export function setGeoDir(dir: string): void {
  GEO_DIR = dir;
  ensureDir();
}

export function getGeoDir(): string {
  return GEO_DIR;
}

function ensureDir(): void {
  if (!fs.existsSync(GEO_DIR)) {
    fs.mkdirSync(GEO_DIR, { recursive: true });
  }
}

export interface GeoMeta {
  filename: string;
  topic: string;
  hash: string;
  updatedAt: Date;
}

function parseGeoTopic(content: Buffer): string {
  try {
    // Skip 4-byte header
    if (content.length < 4) return "unknown";
    const jsonBuf = content.slice(4);
    const parsed = JSON.parse(jsonBuf.toString("utf8"));
    // Try nested paths: extensions.memory.topic or topic at root
    return (
      parsed?.extensions?.memory?.topic ??
      parsed?.topic ??
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

export function listGeos(): GeoMeta[] {
  ensureDir();
  const files = fs.readdirSync(GEO_DIR).filter((f) => f.endsWith(".geo"));
  return files.map((filename) => {
    const filepath = path.join(GEO_DIR, filename);
    const content = fs.readFileSync(filepath);
    const stat = fs.statSync(filepath);
    const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
    const topic = parseGeoTopic(content);
    return { filename, topic, hash, updatedAt: stat.mtime };
  });
}

export function hasGeo(filename: string): boolean {
  ensureDir();
  return fs.existsSync(path.join(GEO_DIR, filename));
}

export function writeGeo(filename: string, content: Buffer | string): void {
  ensureDir();
  const buf = typeof content === "string" ? Buffer.from(content) : content;
  fs.writeFileSync(path.join(GEO_DIR, filename), buf);
}

export function readGeo(filename: string): Buffer {
  ensureDir();
  return fs.readFileSync(path.join(GEO_DIR, filename));
}

export function geoCount(): number {
  ensureDir();
  return fs.readdirSync(GEO_DIR).filter((f) => f.endsWith(".geo")).length;
}

export function getDomains(): string[] {
  ensureDir();
  const files = fs.readdirSync(GEO_DIR).filter((f) => f.endsWith(".geo"));
  const topics = new Set<string>();
  for (const filename of files) {
    const content = fs.readFileSync(path.join(GEO_DIR, filename));
    const topic = parseGeoTopic(content);
    if (topic && topic !== "unknown") topics.add(topic);
  }
  return Array.from(topics).sort();
}

export interface GeoStats {
  count: number;
  totalBytes: number;
  domains: string[];
}

export function getStats(): GeoStats {
  ensureDir();
  const files = fs.readdirSync(GEO_DIR).filter((f) => f.endsWith(".geo"));
  let totalBytes = 0;
  const topics = new Set<string>();
  for (const filename of files) {
    const filepath = path.join(GEO_DIR, filename);
    const content = fs.readFileSync(filepath);
    totalBytes += content.length;
    const topic = parseGeoTopic(content);
    if (topic && topic !== "unknown") topics.add(topic);
  }
  return { count: files.length, totalBytes, domains: Array.from(topics).sort() };
}
