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
exports.startBaselineMonitor = startBaselineMonitor;
/**
 * baseline-monitor.ts — Network health tracker for spore node
 * Pings brain URL every 30s, tracks rolling 5-minute success rate
 */
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const fs = __importStar(require("fs"));
const PING_INTERVAL = 30000; // 30 seconds
const WINDOW_SIZE = 10; // 10 pings = 5 minutes at 30s interval
const LOST_THRESHOLD_MS = 2 * 60000; // 2 minutes
const STATE_FILE = "./spore-state.json";
function headRequest(url) {
    return new Promise((resolve) => {
        try {
            const parsed = new URL(url);
            const lib = parsed.protocol === "https:" ? https : http;
            const req = lib.request({
                hostname: parsed.hostname,
                port: parseInt(parsed.port || (parsed.protocol === "https:" ? "443" : "80"), 10),
                path: parsed.pathname || "/",
                method: "HEAD",
            }, (res) => {
                res.resume();
                resolve(res.statusCode !== undefined && res.statusCode < 600);
            });
            req.on("error", () => resolve(false));
            req.setTimeout(5000, () => { req.destroy(); resolve(false); });
            req.end();
        }
        catch {
            resolve(false);
        }
    });
}
function writeState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, writtenAt: new Date().toISOString() }, null, 2));
    }
    catch { /* non-fatal */ }
}
function startBaselineMonitor(brainUrl) {
    const window = [];
    let totalPings = 0;
    let lastSeen = null;
    let lostSince = null;
    let wasConnected = true;
    let workingConfig = { brainUrl };
    let stopped = false;
    function successRate() {
        if (window.length === 0)
            return 1; // optimistic default
        return window.filter(Boolean).length / window.length;
    }
    function isConnected() {
        if (window.length === 0)
            return true;
        return successRate() > 0;
    }
    async function ping() {
        if (stopped)
            return;
        const ok = await headRequest(brainUrl);
        totalPings++;
        window.push(ok);
        if (window.length > WINDOW_SIZE)
            window.shift();
        if (ok) {
            lastSeen = new Date();
            // Restore event
            if (!wasConnected) {
                wasConnected = true;
                lostSince = null;
                writeState({ event: "connectivity-restored", at: lastSeen.toISOString() });
                console.log(`[monitor] Connectivity restored to ${brainUrl}`);
            }
        }
        else {
            // Check if we've been disconnected long enough
            if (wasConnected && successRate() === 0) {
                wasConnected = false;
                lostSince = new Date();
                console.warn(`[monitor] Connectivity lost to ${brainUrl}`);
            }
            if (!wasConnected && lostSince && Date.now() - lostSince.getTime() > LOST_THRESHOLD_MS) {
                writeState({
                    event: "connectivity-lost",
                    lastSeen: lastSeen?.toISOString() ?? null,
                    workingConfig,
                });
            }
        }
    }
    const interval = setInterval(() => { ping().catch(() => { }); }, PING_INTERVAL);
    ping().catch(() => { }); // immediate first ping
    return {
        stop: () => {
            stopped = true;
            clearInterval(interval);
        },
        isConnected,
        getStats: () => ({
            successRate: successRate(),
            totalPings,
            lastSeen,
            connected: isConnected(),
            lostSince,
        }),
    };
}
