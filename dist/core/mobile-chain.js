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
exports.startMobileChain = startMobileChain;
/**
 * mobile-chain.ts — Battery-aware resource ceiling for constrained hardware
 * Uses phi-compliant resource allocation: 1/φ, 1/φ², 1/φ³
 */
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
// Phi-derived ceilings
const PHI = 1.618033988749895;
const CEILING_CHARGING = 1 / PHI; // ~0.618
const CEILING_BATTERY_HIGH = 1 / (PHI * PHI); // ~0.382
const CEILING_BATTERY_LOW = 1 / (PHI * PHI * PHI); // ~0.236
const CEILING_DORMANT = 0;
const BATTERY_PATH = "/sys/class/power_supply/battery/capacity";
const BATTERY_STATUS_PATH = "/sys/class/power_supply/battery/status";
const RAM_DORMANT_THRESHOLD_MB = 100;
const BATTERY_DORMANT_THRESHOLD = 20;
const BATTERY_LOW_THRESHOLD = 50;
function readBatteryLevel() {
    try {
        if (!fs.existsSync(BATTERY_PATH))
            return null;
        const val = parseInt(fs.readFileSync(BATTERY_PATH, "utf8").trim(), 10);
        return isNaN(val) ? null : val;
    }
    catch {
        return null;
    }
}
function readBatteryStatus() {
    try {
        if (!fs.existsSync(BATTERY_STATUS_PATH))
            return null;
        return fs.readFileSync(BATTERY_STATUS_PATH, "utf8").trim().toLowerCase();
    }
    catch {
        return null;
    }
}
function computeBudget() {
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
    let ceiling;
    let reason;
    if (isCharging) {
        ceiling = CEILING_CHARGING;
        reason = `Charging at ${batteryLevel}% — ceiling 1/φ (${(ceiling * 100).toFixed(1)}%)`;
    }
    else if (batteryLevel > BATTERY_LOW_THRESHOLD) {
        ceiling = CEILING_BATTERY_HIGH;
        reason = `Battery ${batteryLevel}% (good) — ceiling 1/φ² (${(ceiling * 100).toFixed(1)}%)`;
    }
    else {
        ceiling = CEILING_BATTERY_LOW;
        reason = `Battery ${batteryLevel}% (low) — ceiling 1/φ³ (${(ceiling * 100).toFixed(1)}%)`;
    }
    const ramBudgetMB = Math.floor(freeMB * ceiling);
    return { ramBudgetMB, ceiling, dormant: false, reason };
}
function startMobileChain() {
    let currentBudget = computeBudget();
    let stopped = false;
    // Recompute every 30s
    const interval = setInterval(() => {
        if (!stopped) {
            currentBudget = computeBudget();
        }
    }, 30000);
    return {
        getBudget: () => currentBudget,
        isDormant: () => currentBudget.dormant,
        stop: () => {
            stopped = true;
            clearInterval(interval);
        },
    };
}
