/**
 * mobile-chain.ts — Battery-aware resource ceiling for constrained hardware
 * Uses phi-compliant resource allocation: 1/φ, 1/φ², 1/φ³
 */
import * as os from "os";
import * as fs from "fs";

// Phi-derived ceilings
const PHI = 1.618033988749895;
const CEILING_CHARGING = 1 / PHI;          // ~0.618
const CEILING_BATTERY_HIGH = 1 / (PHI * PHI);  // ~0.382
const CEILING_BATTERY_LOW = 1 / (PHI * PHI * PHI); // ~0.236
const CEILING_DORMANT = 0;

const BATTERY_PATH = "/sys/class/power_supply/battery/capacity";
const BATTERY_STATUS_PATH = "/sys/class/power_supply/battery/status";
const RAM_DORMANT_THRESHOLD_MB = 100;
const BATTERY_DORMANT_THRESHOLD = 20;
const BATTERY_LOW_THRESHOLD = 50;

export interface Budget {
  ramBudgetMB: number;
  ceiling: number;
  dormant: boolean;
  reason: string;
}

function readBatteryLevel(): number | null {
  try {
    if (!fs.existsSync(BATTERY_PATH)) return null;
    const val = parseInt(fs.readFileSync(BATTERY_PATH, "utf8").trim(), 10);
    return isNaN(val) ? null : val;
  } catch {
    return null;
  }
}

function readBatteryStatus(): string | null {
  try {
    if (!fs.existsSync(BATTERY_STATUS_PATH)) return null;
    return fs.readFileSync(BATTERY_STATUS_PATH, "utf8").trim().toLowerCase();
  } catch {
    return null;
  }
}

function computeBudget(): Budget {
  const freeBytes = os.freemem();
  const totalBytes = os.totalmem();
  const freeMB = freeBytes / (1024 * 1024);

  // RAM dormant check
  if (freeMB < RAM_DORMANT_THRESHOLD_MB) {
    return {
      ramBudgetMB: 0,
      ceiling: CEILING_DORMANT,
      dormant: true,
      reason: `RAM critically low: ${freeMB.toFixed(0)}MB free`,
    };
  }

  const batteryLevel = readBatteryLevel();
  const batteryStatus = readBatteryStatus();
  const isCharging = batteryStatus === "charging" || batteryStatus === "full";

  // No battery info (desktop/server) — assume full capacity
  if (batteryLevel === null) {
    const ramBudgetMB = Math.floor((freeMB * CEILING_CHARGING));
    return {
      ramBudgetMB,
      ceiling: CEILING_CHARGING,
      dormant: false,
      reason: "No battery detected — full ceiling (charging mode)",
    };
  }

  // Battery dormant
  if (batteryLevel < BATTERY_DORMANT_THRESHOLD) {
    return {
      ramBudgetMB: 0,
      ceiling: CEILING_DORMANT,
      dormant: true,
      reason: `Battery critical: ${batteryLevel}%`,
    };
  }

  let ceiling: number;
  let reason: string;

  if (isCharging) {
    ceiling = CEILING_CHARGING;
    reason = `Charging at ${batteryLevel}% — ceiling 1/φ (${(ceiling * 100).toFixed(1)}%)`;
  } else if (batteryLevel > BATTERY_LOW_THRESHOLD) {
    ceiling = CEILING_BATTERY_HIGH;
    reason = `Battery ${batteryLevel}% (good) — ceiling 1/φ² (${(ceiling * 100).toFixed(1)}%)`;
  } else {
    ceiling = CEILING_BATTERY_LOW;
    reason = `Battery ${batteryLevel}% (low) — ceiling 1/φ³ (${(ceiling * 100).toFixed(1)}%)`;
  }

  const ramBudgetMB = Math.floor(freeMB * ceiling);
  return { ramBudgetMB, ceiling, dormant: false, reason };
}

export interface MobileChain {
  getBudget: () => Budget;
  isDormant: () => boolean;
  stop: () => void;
}

export function startMobileChain(): MobileChain {
  let currentBudget = computeBudget();
  let stopped = false;

  // Recompute every 30s
  const interval = setInterval(() => {
    if (!stopped) {
      currentBudget = computeBudget();
    }
  }, 30_000);

  return {
    getBudget: () => currentBudget,
    isDormant: () => currentBudget.dormant,
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
  };
}
