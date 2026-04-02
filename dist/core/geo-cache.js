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
exports.setGeoDir = setGeoDir;
exports.getGeoDir = getGeoDir;
exports.listGeos = listGeos;
exports.hasGeo = hasGeo;
exports.writeGeo = writeGeo;
exports.readGeo = readGeo;
exports.geoCount = geoCount;
exports.getDomains = getDomains;
exports.getStats = getStats;
/**
 * geo-cache.ts — Geo file manager for spore node
 * Handles the GEO\x00{json} format used by the Shovelcat colony
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
// GEO format: 4-byte header "GEO\x00" followed by UTF-8 JSON
const GEO_HEADER = Buffer.from([0x47, 0x45, 0x4f, 0x00]); // "GEO\0"
let GEO_DIR = process.env.GEO_DIR ?? path.join(process.cwd(), "geo-cache");
function setGeoDir(dir) {
    GEO_DIR = dir;
    ensureDir();
}
function getGeoDir() {
    return GEO_DIR;
}
function ensureDir() {
    if (!fs.existsSync(GEO_DIR)) {
        fs.mkdirSync(GEO_DIR, { recursive: true });
    }
}
function parseGeoTopic(content) {
    try {
        // Skip 4-byte header
        if (content.length < 4)
            return "unknown";
        const jsonBuf = content.slice(4);
        const parsed = JSON.parse(jsonBuf.toString("utf8"));
        // Try nested paths: extensions.memory.topic or topic at root
        return (parsed?.extensions?.memory?.topic ??
            parsed?.topic ??
            "unknown");
    }
    catch {
        return "unknown";
    }
}
function listGeos() {
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
function hasGeo(filename) {
    ensureDir();
    return fs.existsSync(path.join(GEO_DIR, filename));
}
function writeGeo(filename, content) {
    ensureDir();
    const buf = typeof content === "string" ? Buffer.from(content) : content;
    fs.writeFileSync(path.join(GEO_DIR, filename), buf);
}
function readGeo(filename) {
    ensureDir();
    return fs.readFileSync(path.join(GEO_DIR, filename));
}
function geoCount() {
    ensureDir();
    return fs.readdirSync(GEO_DIR).filter((f) => f.endsWith(".geo")).length;
}
function getDomains() {
    ensureDir();
    const files = fs.readdirSync(GEO_DIR).filter((f) => f.endsWith(".geo"));
    const topics = new Set();
    for (const filename of files) {
        const content = fs.readFileSync(path.join(GEO_DIR, filename));
        const topic = parseGeoTopic(content);
        if (topic && topic !== "unknown")
            topics.add(topic);
    }
    return Array.from(topics).sort();
}
function getStats() {
    ensureDir();
    const files = fs.readdirSync(GEO_DIR).filter((f) => f.endsWith(".geo"));
    let totalBytes = 0;
    const topics = new Set();
    for (const filename of files) {
        const filepath = path.join(GEO_DIR, filename);
        const content = fs.readFileSync(filepath);
        totalBytes += content.length;
        const topic = parseGeoTopic(content);
        if (topic && topic !== "unknown")
            topics.add(topic);
    }
    return { count: files.length, totalBytes, domains: Array.from(topics).sort() };
}
