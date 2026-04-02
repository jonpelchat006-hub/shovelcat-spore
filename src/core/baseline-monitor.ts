/**
 * baseline-monitor.ts — Network health tracker for spore node
 * Pings brain URL every 30s, tracks rolling 5-minute success rate
 */
import * as http from "http";
import * as https from "https";
import * as fs from "fs";

const PING_INTERVAL = 30_000;          // 30 seconds
const WINDOW_SIZE = 10;                // 10 pings = 5 minutes at 30s interval
const LOST_THRESHOLD_MS = 2 * 60_000; // 2 minutes
const STATE_FILE = "./spore-state.json";

export interface MonitorStats {
  successRate: number;     // 0–1 over last 5 minutes
  totalPings: number;
  lastSeen: Date | null;
  connected: boolean;
  lostSince: Date | null;
}

export interface BaselineMonitor {
  stop: () => void;
  isConnected: () => boolean;
  getStats: () => MonitorStats;
}

function headRequest(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === "https:" ? https : http;
      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parseInt(parsed.port || (parsed.protocol === "https:" ? "443" : "80"), 10),
          path: parsed.pathname || "/",
          method: "HEAD",
        },
        (res) => {
          res.resume();
          resolve(res.statusCode !== undefined && res.statusCode < 600);
        }
      );
      req.on("error", () => resolve(false));
      req.setTimeout(5000, () => { req.destroy(); resolve(false); });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

function writeState(state: object): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, writtenAt: new Date().toISOString() }, null, 2));
  } catch { /* non-fatal */ }
}

export function startBaselineMonitor(brainUrl: string): BaselineMonitor {
  const window: boolean[] = [];
  let totalPings = 0;
  let lastSeen: Date | null = null;
  let lostSince: Date | null = null;
  let wasConnected = true;
  let workingConfig = { brainUrl };
  let stopped = false;

  function successRate(): number {
    if (window.length === 0) return 1; // optimistic default
    return window.filter(Boolean).length / window.length;
  }

  function isConnected(): boolean {
    if (window.length === 0) return true;
    return successRate() > 0;
  }

  async function ping(): Promise<void> {
    if (stopped) return;
    const ok = await headRequest(brainUrl);
    totalPings++;

    window.push(ok);
    if (window.length > WINDOW_SIZE) window.shift();

    if (ok) {
      lastSeen = new Date();
      // Restore event
      if (!wasConnected) {
        wasConnected = true;
        lostSince = null;
        writeState({ event: "connectivity-restored", at: lastSeen.toISOString() });
        console.log(`[monitor] Connectivity restored to ${brainUrl}`);
      }
    } else {
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

  const interval = setInterval(() => { ping().catch(() => {}); }, PING_INTERVAL);
  ping().catch(() => {}); // immediate first ping

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
    isConnected,
    getStats: (): MonitorStats => ({
      successRate: successRate(),
      totalPings,
      lastSeen,
      connected: isConnected(),
      lostSince,
    }),
  };
}
