/**
 * inbox.ts — Polls geo dir for incoming messages and manages the local inbox
 */
import * as fs from 'fs';
import * as path from 'path';
import { decryptFromSender, decryptGroup } from './crypto-identity';
import { parseMessage, parseFlag, getTrustTemperature } from './message-geo';
import type { SporeIdentity } from './crypto-identity';

export interface InboxMessage {
  filename:    string;
  from:        string;
  fromWords:   string | null;
  payloadType: 'direct' | 'group' | 'broadcast';
  body:        string | null;   // null if can't decrypt
  decrypted:   boolean;
  sentAt:      string;
  flagScore:   number;          // 0-1 from getTrustTemperature
  rawGeo:      string;
}

export interface InboxHandle {
  stop():                    void;
  getMessages():             InboxMessage[];
  addGroupKey(hex: string):  void;
}

export function startInbox(opts: {
  identity:       SporeIdentity;
  geoDir:         string;
  groupKeys:      string[];
  onMessage:      (msg: InboxMessage) => void;
  pollIntervalMs?: number;
}): InboxHandle {
  const {
    identity, geoDir, onMessage,
    pollIntervalMs = 10_000,
  } = opts;

  const groupKeys   = [...opts.groupKeys];
  const seen        = new Set<string>();
  const inbox:      InboxMessage[] = [];
  let   stopped     = false;
  let   timer:      ReturnType<typeof setTimeout> | null = null;

  // ── scan once ──────────────────────────────────────────────────────────────
  function scan(): void {
    if (stopped) return;

    let files: string[];
    try {
      files = fs.readdirSync(geoDir).filter(f => f.endsWith('.geo'));
    } catch { scheduleNext(); return; }

    // Collect flag geos for trust scoring
    const flagGeos: string[] = [];
    for (const filename of files) {
      try {
        const raw = readGeoAsString(path.join(geoDir, filename));
        const hdr = Buffer.from(raw, 'binary').slice(0, 4).toString();
        if (hdr !== 'GEO\x00') continue;
        if (parseFlag(raw)) flagGeos.push(raw);
      } catch { /* skip bad files */ }
    }

    for (const filename of files) {
      if (seen.has(filename)) continue;

      try {
        const raw = readGeoAsString(path.join(geoDir, filename));
        const msg = parseMessage(raw);
        if (!msg) continue;          // not a message geo

        seen.add(filename);

        const flagScore = getTrustTemperature(msg.from, flagGeos);
        let body:      string | null = null;
        let decrypted  = false;

        // ── Direct ──────────────────────────────────────────────────────────
        if (msg.payloadType === 'direct' && msg.to === identity.nodeId) {
          try {
            body      = decryptFromSender(msg.rawEncrypted, identity.encPrivateKey);
            decrypted = true;
          } catch { /* wrong key or not for us */ }

        // ── Group ────────────────────────────────────────────────────────────
        } else if (msg.payloadType === 'group' && msg.to.startsWith('#')) {
          for (const key of groupKeys) {
            if (msg.groupKeyHint && !key.startsWith(msg.groupKeyHint)) continue;
            try {
              body      = decryptGroup(msg.rawEncrypted, key);
              decrypted = true;
              break;
            } catch { /* wrong key, try next */ }
          }

        // ── Broadcast ────────────────────────────────────────────────────────
        } else if (msg.payloadType === 'broadcast' && msg.to.startsWith('scope:')) {
          try {
            body      = Buffer.from(msg.rawEncrypted, 'base64').toString('utf8');
            decrypted = true;
          } catch { /* corrupt broadcast */ }
        } else {
          // Not addressed to us — still track it as seen but don't emit
          continue;
        }

        const inboxMsg: InboxMessage = {
          filename,
          from:        msg.from,
          fromWords:   msg.fromWords,
          payloadType: msg.payloadType,
          body,
          decrypted,
          sentAt:      msg.sentAt,
          flagScore,
          rawGeo:      raw,
        };

        inbox.push(inboxMsg);
        try { onMessage(inboxMsg); } catch { /* caller error, don't crash */ }

      } catch { /* malformed geo, skip */ }
    }

    scheduleNext();
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(scan, pollIntervalMs);
  }

  // Start immediately
  scan();

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    getMessages(): InboxMessage[] {
      return [...inbox];
    },
    addGroupKey(hex: string): void {
      if (!groupKeys.includes(hex)) groupKeys.push(hex);
    },
  };
}

// ── Helper: read geo file as binary string ─────────────────────────────────
function readGeoAsString(filepath: string): string {
  return fs.readFileSync(filepath).toString('binary');
}
