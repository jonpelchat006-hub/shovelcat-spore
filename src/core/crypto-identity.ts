/**
 * crypto-identity.ts — Keypair generation and message crypto for spore nodes
 * Uses ONLY Node.js built-in crypto module. Zero npm runtime dependencies.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ── 256-word list (word[byte] → 256³ = 16.7M combinations) ──────────────────
export const WORDS: readonly string[] = [
  'river','falcon','stone','amber','bright','cloud','delta','echo','frost','golden',
  'harbor','iron','jade','kelp','lunar','marsh','nova','ocean','pine','quartz',
  'reef','silver','tide','ultra','violet','wave','xenon','yellow','zinc','alpine',
  'basin','cedar','drift','ember','fjord','grove','haven','inlet','jasper','kestrel',
  'lagoon','maple','night','orbit','patrol','quill','raven','storm','tundra','uplift',
  'vortex','willow','xray','yarrow','zenith','anchor','blaze','coral','dusk','eagle',
  'flint','granite','hawk','island','jungle','kite','lance','meadow','noble','opal',
  'prism','quarry','robin','sage','thunder','umber','vale','warren','xerus','yonder',
  'zephyr','arctic','brook','canyon','dawn','elder','fern','glacier','holly','ivy',
  'juniper','kaolin','larch','mire','nectar','onyx','peak','quest','rush','slate',
  'terra','union','verdant','wolf','xylem','yew','zinc2','alder','birch','cobalt',
  'dune','elm','flax','gorse','heath','ire','jest','knoll','lime','moss',
  'nook','ore','peat','quake','reed','soil','thorn','ursa','vent','wren',
  'axis','bolt','cave','dell','etch','ford','gale','hull','isle','jolt',
  'keel','loft','mast','nave','oak','port','raft','silt','toll','urn',
  'volt','wake','yaw','abbot','baron','crane','dirk','earl','fife','guild',
  'hilt','jager','kern','lute','mace','nave2','orb','pike','rand','spur',
  'tarn','vale2','weld','yore','abbey','brae','croft','dale','firth','glen',
  'holm','inch','knap','linn','mere','ness','ouse','pool','rill','shaw',
  'toft','weir','beck','burn','carr','dike','fell','ghyll','hagg','ings',
  'keld','leat','moor','naab','oxbow','peel','rhos','sike','tor','uig',
  'voe','wick','yat','zawn','argh','bield','clough','dod','esk','force',
  'garth','hag','iver','joe','knott','lund',
  'ash','bay','cape','dew','eve','fog','gem','hay','ink','jar',
  'kin','log','mud','net','owl','pad','ram','rod','rye','sea',
  'sky','tan','van','web','zen','bud','cob','dam','elk','fig',
];

// ── Identity types ────────────────────────────────────────────────────────────
export interface SporeIdentity {
  nodeId: string;
  publicKey: string;      // Ed25519 signing public key, base64 DER (SPKI)
  privateKey: string;     // Ed25519 signing private key, base64 DER (PKCS8, unencrypted in memory)
  encPublicKey: string;   // RSA-2048 encryption public key, base64 DER (SPKI)
  encPrivateKey: string;  // RSA-2048 encryption private key, base64 DER (PKCS8, unencrypted in memory)
}

function derivePassphrase(nodeId: string): string {
  return crypto.createHash('sha256').update('shovelcat:' + nodeId).digest('hex');
}

// ── Identity load/create ──────────────────────────────────────────────────────
export function loadOrCreateIdentity(identityPath: string): SporeIdentity {
  let data: Record<string, unknown> = {};
  if (fs.existsSync(identityPath)) {
    try { data = JSON.parse(fs.readFileSync(identityPath, 'utf8')); } catch { /* fresh */ }
  }

  let changed = false;
  if (!data.nodeId) {
    data.nodeId = crypto.randomBytes(16).toString('hex');
    changed = true;
  }
  const nodeId = data.nodeId as string;
  const passphrase = derivePassphrase(nodeId);

  // Ed25519 signing keypair
  if (!data.publicKey || !data.privateKey) {
    const kp = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding:  { type: 'spki',  format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der', cipher: 'aes-256-cbc', passphrase },
    });
    data.publicKey  = (kp.publicKey  as unknown as Buffer).toString('base64');
    data.privateKey = (kp.privateKey as unknown as Buffer).toString('base64');
    changed = true;
  }

  // RSA-2048 encryption keypair
  if (!data.encPublicKey || !data.encPrivateKey) {
    const kp = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der', cipher: 'aes-256-cbc', passphrase },
    });
    data.encPublicKey  = (kp.publicKey  as unknown as Buffer).toString('base64');
    data.encPrivateKey = (kp.privateKey as unknown as Buffer).toString('base64');
    changed = true;
  }

  if (changed) {
    fs.mkdirSync(path.dirname(path.resolve(identityPath)), { recursive: true });
    fs.writeFileSync(identityPath, JSON.stringify(data, null, 2));
  }

  // Decrypt private keys → unencrypted DER for in-memory use (auto-unlocked via nodeId)
  const sigPrivKey = crypto.createPrivateKey({
    key: Buffer.from(data.privateKey as string, 'base64'),
    format: 'der', type: 'pkcs8', passphrase,
  });
  const encPrivKey = crypto.createPrivateKey({
    key: Buffer.from(data.encPrivateKey as string, 'base64'),
    format: 'der', type: 'pkcs8', passphrase,
  });

  return {
    nodeId,
    publicKey:    data.publicKey as string,
    privateKey:   sigPrivKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    encPublicKey: data.encPublicKey as string,
    encPrivateKey: encPrivKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

// ── Ed25519 signing ───────────────────────────────────────────────────────────
export function signMessage(content: string, privateKeyB64: string): string {
  const key = crypto.createPrivateKey({ key: Buffer.from(privateKeyB64, 'base64'), format: 'der', type: 'pkcs8' });
  return crypto.sign(null, Buffer.from(content, 'utf8'), key).toString('base64');
}

export function verifySignature(content: string, signature: string, publicKeyB64: string): boolean {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(content, 'utf8'), key, Buffer.from(signature, 'base64'));
  } catch { return false; }
}

// ── RSA hybrid encryption (RSA-OAEP wraps AES-256-GCM key) ───────────────────
export function encryptForRecipient(message: string, recipientEncPublicKeyB64: string): string {
  const aesKey = crypto.randomBytes(32);
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const body   = Buffer.concat([cipher.update(message, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();

  const pubKey     = crypto.createPublicKey({ key: Buffer.from(recipientEncPublicKeyB64, 'base64'), format: 'der', type: 'spki' });
  const wrappedKey = crypto.publicEncrypt({ key: pubKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, aesKey);

  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(wrappedKey.length, 0);
  return Buffer.concat([lenBuf, wrappedKey, iv, tag, body]).toString('base64');
}

export function decryptFromSender(ciphertext: string, myEncPrivateKeyB64: string): string {
  const buf        = Buffer.from(ciphertext, 'base64');
  const keyLen     = buf.readUInt32BE(0);
  const wrappedKey = buf.slice(4, 4 + keyLen);
  const iv         = buf.slice(4 + keyLen, 4 + keyLen + 12);
  const tag        = buf.slice(4 + keyLen + 12, 4 + keyLen + 28);
  const body       = buf.slice(4 + keyLen + 28);

  const privKey = crypto.createPrivateKey({ key: Buffer.from(myEncPrivateKeyB64, 'base64'), format: 'der', type: 'pkcs8' });
  const aesKey  = crypto.privateDecrypt({ key: privKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, wrappedKey);

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

// ── Group keys (AES-256-GCM) ──────────────────────────────────────────────────
export function generateGroupKey(): { key: string; words: string } {
  const keyBytes   = crypto.randomBytes(32);
  const wordBytes  = crypto.randomBytes(3);
  const wordTriple = [WORDS[wordBytes[0]], WORDS[wordBytes[1]], WORDS[wordBytes[2]]].join(' ');
  return { key: keyBytes.toString('hex'), words: wordTriple };
}

export function encryptGroup(message: string, groupKeyHex: string): string {
  const key    = Buffer.from(groupKeyHex, 'hex');
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body   = Buffer.concat([cipher.update(message, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString('base64');
}

export function decryptGroup(ciphertext: string, groupKeyHex: string): string {
  const key      = Buffer.from(groupKeyHex, 'hex');
  const buf      = Buffer.from(ciphertext, 'base64');
  const iv       = buf.slice(0, 12);
  const tag      = buf.slice(12, 28);
  const body     = buf.slice(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

// ── Word registry (local ./word-registry.json) ────────────────────────────────
const REGISTRY_PATH = path.resolve('./word-registry.json');

interface RegistryEntry { nodeId: string; publicKey: string; encPublicKey?: string; registeredAt: string; }
type Registry = Record<string, RegistryEntry>;

function loadRegistry(): Registry {
  try { return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')); } catch { return {}; }
}

function saveRegistry(reg: Registry): void {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
}

export function wordsToNodeId(words: string): string | null {
  const reg = loadRegistry();
  return reg[words]?.nodeId ?? null;
}

export function nodeIdToWords(nodeId: string): string | null {
  const reg = loadRegistry();
  const entry = Object.entries(reg).find(([, v]) => v.nodeId === nodeId);
  return entry ? entry[0] : null;
}

export function registerWords(words: string, nodeId: string, publicKey: string, encPublicKey?: string): void {
  const reg = loadRegistry();
  reg[words] = { nodeId, publicKey, encPublicKey, registeredAt: new Date().toISOString() };
  saveRegistry(reg);
}
