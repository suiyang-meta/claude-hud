#!/usr/bin/env node
/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
/**
 * Writes, signs and checks latest.json — the file the in-app updater reads.
 *
 *   security find-generic-password -s hud-for-claude-update-key -a release -w \
 *     | node scripts/release-manifest.js sign <stage-dir> <version>
 *   node scripts/release-manifest.js verify <stage-dir> <version> [--remote]
 *
 * sign reads the Ed25519 private key (base64 PKCS#8 DER, as kept in the
 * keychain) from stdin, so it never lands in a file, an argument or the
 * environment. It then checks its own signature against the public key the
 * app carries, so a mismatched key fails here — once — instead of on every
 * user's machine.
 *
 * verify re-checks a staged (or, with --remote, a downloaded) latest.json: the
 * signature, the version, and — unless --remote — each file's size and hash.
 *
 * latest.json carries its own signature — {"manifest": "<json text>",
 * "signature": "<base64>"} — so one upload replaces both at once, and no cache
 * can ever serve a new manifest with an old signature.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PUBLIC_KEY = require('../widget/update/publicKey');

// What the app looks up by `${process.platform}-${process.arch}`.
const PAYLOADS = (v) => ({
  'darwin-arm64': `HUD-for-Claude-${v}-arm64.dmg`,
  'win32-x64': `HUD-for-Claude-${v}-win-x64.zip`,
});

const die = (m) => { console.error('  ✗ ' + m); process.exit(1); };
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const verifies = (text, sig) => crypto.verify(null, Buffer.from(text, 'utf8'),
  crypto.createPublicKey(PUBLIC_KEY), Buffer.from(String(sig).trim(), 'base64'));

/** The release machine's own calendar day — the day the release is made. */
function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sign(dir, version) {
  const manifest = { version, date: localDay(), files: {} };
  for (const [platform, name] of Object.entries(PAYLOADS(version))) {
    const file = path.join(dir, name);
    // Both or nothing: a manifest without one platform tells its users they
    // are up to date when they are not.
    if (!fs.existsSync(file)) die(`missing ${name} — build both platforms first`);
    const buf = fs.readFileSync(file);
    manifest.files[platform] = { name, size: buf.length, sha256: sha256(buf) };
  }
  const text = JSON.stringify(manifest, null, 2) + '\n';
  const key = fs.readFileSync(0, 'utf8').trim();
  if (!key) die('no private key on stdin');
  const sig = crypto.sign(null, Buffer.from(text, 'utf8'),
    crypto.createPrivateKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'pkcs8' }))
    .toString('base64');
  if (!verifies(text, sig)) die('this key does not match widget/update/publicKey.js — the app would reject it');
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ manifest: text, signature: sig }, null, 2) + '\n');
  console.log(`  ✓ latest.json for ${version} signed and checked against the app's key`);
}

function verify(dir, version, remote) {
  const { manifest: text, signature: sig } = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'));
  if (typeof text !== 'string' || typeof sig !== 'string') die('latest.json has no manifest / signature pair');
  if (!verifies(text, sig)) die('latest.json does not verify against the app’s key');
  const m = JSON.parse(text);
  if (m.version !== version) die(`latest.json says ${m.version}, expected ${version}`);
  for (const [platform, name] of Object.entries(PAYLOADS(version))) {
    const f = m.files && m.files[platform];
    if (!f || f.name !== name) die(`latest.json has no ${platform} entry named ${name}`);
    if (remote) continue;
    const buf = fs.readFileSync(path.join(dir, name));
    if (buf.length !== f.size || sha256(buf) !== f.sha256) die(`${name} does not match latest.json`);
  }
  console.log(`  ✓ latest.json ${version} verifies${remote ? ' (as served)' : ', and so do both files'}`);
}

const [mode, dir, version, flag] = process.argv.slice(2);
if (!dir || !/^\d+\.\d+\.\d+$/.test(version || '')) die('usage: release-manifest.js sign|verify <dir> <x.y.z> [--remote]');
if (mode === 'sign') sign(dir, version);
else if (mode === 'verify') verify(dir, version, flag === '--remote');
else die(`unknown mode ${mode}`);
