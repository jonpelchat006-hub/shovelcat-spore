/**
 * message-geo.ts — Message and flag geo file creation/parsing for Shovelcat
 * GEO format: Buffer.from('GEO\x00') + JSON payload
 */
import * as crypto from 'crypto';
import {
  encryptForRecipient, encryptGroup, signMessage, verifySignature,
  type SporeIdentity,
} from './crypto-identity';

// ── GEO header ────────────────────────────────────────────────────────────────
const GEO_HEADER = Buffer.from('GEO\x00');

function makeGeo(payload: unknown): string {
  return Buffer.concat([GEO_HEADER, Buffer.from(JSON.stringify(payload))]).toString('binary');
}

function parseGeo(geoContent: string): unknown | null {
  try {
    const buf = Buffer.from(geoContent, 'binary');
    if (buf.slice(0, 4).toString() !== 'GEO\x00') return null;
    return JSON.parse(buf.slice(4).toString('utf8'));
  } catch { return null; }
}

// ── Message types ─────────────────────────────────────────────────────────────
export interface ParsedMessage {
  to: string;
  from: string;
  fromWords: string | null;
  payloadType: 'direct' | 'group' | 'broadcast';
  groupKeyHint: string | null;
  signature: string;
  sentAt: string;
  ttl: number;
  rawEncrypted: string;
}

export interface ParsedFlag {
  target: string;
  reason: string;
  flaggedBy: string;
  at: string;
  signature: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildGeoIdentity(nodeId: string): Record<string, unknown> {
  return { nodeId, version: '1.0', createdAt: new Date().toISOString() };
}

function sigPayload(to: string, from: string, encryptedPayload: string, sentAt: string): string {
  return to + from + encryptedPayload + sentAt;
}

// ── createDirectMessage ───────────────────────────────────────────────────────
export function createDirectMessage(opts: {
  to: string;
  toPublicKey: string;   // RSA enc public key of recipient
  from: string;
  fromWords: string | null;
  body: string;
  identity: SporeIdentity;
}): string {
  const sentAt = new Date().toISOString();
  const encryptedPayload = encryptForRecipient(opts.body, opts.toPublicKey);
  const sig = signMessage(sigPayload(opts.to, opts.from, encryptedPayload, sentAt), opts.identity.privateKey);

  return makeGeo({
    identity: buildGeoIdentity(opts.from),
    extensions: {
      message: {
        to: opts.to,
        from: opts.from,
        fromWords: opts.fromWords,
        encryptedPayload,
        payloadType: 'direct',
        groupKeyHint: null,
        signature: sig,
        sentAt,
        ttl: 86400,
        flagScore: 0,
      },
    },
  });
}

// ── createGroupMessage ────────────────────────────────────────────────────────
export function createGroupMessage(opts: {
  groupKeyHex: string;
  groupWords: string;
  from: string;
  fromWords: string | null;
  body: string;
  scope: string;
  identity: SporeIdentity;
}): string {
  const sentAt = new Date().toISOString();
  const to = '#' + opts.groupWords.replace(/\s+/g, '-');
  const encryptedPayload = encryptGroup(opts.body, opts.groupKeyHex);
  const hint = opts.groupKeyHex.slice(0, 8);
  const sig  = signMessage(sigPayload(to, opts.from, encryptedPayload, sentAt), opts.identity.privateKey);

  return makeGeo({
    identity: buildGeoIdentity(opts.from),
    extensions: {
      message: {
        to,
        from: opts.from,
        fromWords: opts.fromWords,
        encryptedPayload,
        payloadType: 'group',
        groupKeyHint: hint,
        signature: sig,
        sentAt,
        ttl: 86400,
        flagScore: 0,
      },
    },
  });
}

// ── createBroadcast ───────────────────────────────────────────────────────────
export function createBroadcast(opts: {
  from: string;
  fromWords: string | null;
  body: string;
  scope: string;
  identity: SporeIdentity;
}): string {
  const sentAt = new Date().toISOString();
  const to = 'scope:' + opts.scope;
  // Broadcast body is base64-encoded plaintext (no encryption)
  const encryptedPayload = Buffer.from(opts.body, 'utf8').toString('base64');
  const sig = signMessage(sigPayload(to, opts.from, encryptedPayload, sentAt), opts.identity.privateKey);

  return makeGeo({
    identity: buildGeoIdentity(opts.from),
    extensions: {
      message: {
        to,
        from: opts.from,
        fromWords: opts.fromWords,
        encryptedPayload,
        payloadType: 'broadcast',
        groupKeyHint: null,
        signature: sig,
        sentAt,
        ttl: 86400,
        flagScore: 0,
      },
    },
  });
}

// ── parseMessage ──────────────────────────────────────────────────────────────
export function parseMessage(geoContent: string): ParsedMessage | null {
  const parsed = parseGeo(geoContent) as Record<string, unknown> | null;
  if (!parsed) return null;
  const msg = (parsed?.extensions as Record<string, unknown>)?.message as Record<string, unknown>;
  if (!msg) return null;

  if (
    typeof msg.to !== 'string' || typeof msg.from !== 'string' ||
    typeof msg.encryptedPayload !== 'string' || typeof msg.signature !== 'string' ||
    typeof msg.sentAt !== 'string' || typeof msg.payloadType !== 'string'
  ) return null;

  return {
    to:            msg.to,
    from:          msg.from,
    fromWords:     typeof msg.fromWords === 'string' ? msg.fromWords : null,
    payloadType:   msg.payloadType as 'direct' | 'group' | 'broadcast',
    groupKeyHint:  typeof msg.groupKeyHint === 'string' ? msg.groupKeyHint : null,
    signature:     msg.signature,
    sentAt:        msg.sentAt,
    ttl:           typeof msg.ttl === 'number' ? msg.ttl : 86400,
    rawEncrypted:  msg.encryptedPayload,
  };
}

// ── createFlag ────────────────────────────────────────────────────────────────
export function createFlag(opts: {
  target: string;
  reason: 'spam' | 'abuse' | 'misinformation' | 'other';
  flaggedBy: string;
  identity: SporeIdentity;
}): string {
  const at  = new Date().toISOString();
  const sig = signMessage(opts.target + opts.reason + opts.flaggedBy + at, opts.identity.privateKey);

  return makeGeo({
    identity: buildGeoIdentity(opts.flaggedBy),
    extensions: {
      flag: {
        target:    opts.target,
        reason:    opts.reason,
        flaggedBy: opts.flaggedBy,
        at,
        signature: sig,
      },
    },
  });
}

// ── parseFlag ─────────────────────────────────────────────────────────────────
export function parseFlag(geoContent: string): ParsedFlag | null {
  const parsed = parseGeo(geoContent) as Record<string, unknown> | null;
  if (!parsed) return null;
  const flag = (parsed?.extensions as Record<string, unknown>)?.flag as Record<string, unknown>;
  if (!flag) return null;

  if (
    typeof flag.target    !== 'string' || typeof flag.reason    !== 'string' ||
    typeof flag.flaggedBy !== 'string' || typeof flag.at        !== 'string' ||
    typeof flag.signature !== 'string'
  ) return null;

  return {
    target:    flag.target,
    reason:    flag.reason,
    flaggedBy: flag.flaggedBy,
    at:        flag.at,
    signature: flag.signature,
  };
}

// ── Trust temperature ─────────────────────────────────────────────────────────
// 0.0 = cold (trusted), 1.0 = hot (flagged)
export function getTrustTemperature(nodeId: string, flagGeos: string[]): number {
  const now = Date.now();
  const DAY_MS = 86_400_000;

  let score = 0;
  for (const geo of flagGeos) {
    const flag = parseFlag(geo);
    if (!flag || flag.target !== nodeId) continue;
    const age  = now - new Date(flag.at).getTime();
    const days = age / DAY_MS;
    // Exponential decay: full weight < 1 day, half weight at 7 days
    const weight = Math.exp(-days * Math.LN2 / 7);
    score += weight;
  }

  // Clamp to 0-1: cap = 5 flags → full heat
  return Math.min(1, score / 5);
}

// Re-export SporeIdentity for consumers of this module
export type { SporeIdentity };
