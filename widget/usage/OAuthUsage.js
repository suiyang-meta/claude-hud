'use strict';
/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
/**
 * OAuthUsage — quota via Claude Code's own OAuth credential.
 *
 * Replaces the Chrome-extension DOM scrape. Claude Code refreshes the credential
 * on its own, so we re-read the store before every call rather than managing
 * refresh here. Endpoints are undocumented internals — treat every field as
 * optional.
 *
 * Two stores, because Claude Code itself uses two: the macOS keychain where one
 * exists, and ~/.claude/.credentials.json everywhere else. Reads try the keychain
 * first on darwin and fall back to the file, which also covers a Mac user who
 * declined the keychain prompt. Writes go back to whichever one answered.
 */
const { execFile } = require('child_process');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
// Claude Code's own OAuth client, matching application.uuid from /api/oauth/profile.
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const API = 'https://api.anthropic.com';
const OAUTH_BETA = 'oauth-2025-04-20';

function parseBlob(raw, where) {
  let blob;
  try { blob = JSON.parse(raw).claudeAiOauth; }
  catch { throw new Error(where + ' is not the expected JSON shape'); }
  if (!blob || !blob.accessToken) throw new Error('no accessToken in ' + where);
  return blob;
}

function readKeychain() {
  return new Promise((resolve, reject) => {
    execFile('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { timeout: 10000 }, (err, stdout) => {
        if (err) return reject(new Error('keychain read denied or entry missing'));
        try { resolve(parseBlob(stdout.trim(), 'keychain credential')); }
        catch (e) { reject(e); }
      });
  });
}

/**
 * Claude Code's own resolution order for the credential directory, taken from
 * its binary: an explicit secure-storage dir wins, then CLAUDE_CONFIG_DIR, then
 * ~/.claude. On Windows os.homedir() gives %USERPROFILE%, which is where Claude
 * Code puts it.
 */
function credentialFilePath() {
  const dir = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR
           || process.env.CLAUDE_CONFIG_DIR
           || path.join(os.homedir(), '.claude');
  return path.join(dir, '.credentials.json');
}

async function readCredentialFile() {
  const p = credentialFilePath();
  let raw;
  try { raw = await fsp.readFile(p, 'utf8'); }
  catch { throw new Error('no credential file at ' + p); }
  return parseBlob(raw, 'credential file');
}

/** Which store answered last, so a refresh is written back to the same one. */
let credentialSource = null;

async function readCredential() {
  const tried = [];
  if (process.platform === 'darwin') {
    try { const b = await readKeychain(); credentialSource = 'keychain'; return b; }
    catch (e) { tried.push('keychain: ' + e.message); }
  }
  try { const b = await readCredentialFile(); credentialSource = 'file'; return b; }
  catch (e) { tried.push('file: ' + e.message); }
  throw new Error(tried.join(' / '));
}

/** Keychain account name for the entry, so an update targets it rather than
 *  creating a second one. */
function readAccount() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve('');
    execFile('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE],
      { timeout: 10000 }, (err, stdout) => {
        const m = !err && /"acct"<blob>="([^"]+)"/.exec(stdout || '');
        resolve(m ? m[1] : process.env.USER || '');
      });
  });
}

function writeKeychain(blob, account) {
  const payload = JSON.stringify({ claudeAiOauth: blob });
  return new Promise((resolve, reject) => {
    execFile('security',
      ['add-generic-password', '-U', '-a', account, '-s', KEYCHAIN_SERVICE, '-w', payload],
      { timeout: 10000 }, (err) => err ? reject(new Error('keychain write failed')) : resolve());
  });
}

/**
 * Rewrite only the OAuth section, preserving any other keys in the file, and
 * land it atomically — a half-written credential file signs Claude Code out.
 */
async function writeCredentialFile(blob) {
  const p = credentialFilePath();
  let existing = {};
  try { existing = JSON.parse(await fsp.readFile(p, 'utf8')); } catch { /* new file */ }
  const tmp = p + '.hud-tmp';
  await fsp.writeFile(tmp, JSON.stringify({ ...existing, claudeAiOauth: blob }), { mode: 0o600 });
  await fsp.rename(tmp, p);
}

function writeCredential(blob, account) {
  return credentialSource === 'keychain'
    ? writeKeychain(blob, account)
    : writeCredentialFile(blob);
}

/**
 * Exchange the refresh token for a new access token.
 *
 * Anthropic rotates refresh tokens — the old one dies on use — so the result
 * MUST land back in the store or Claude Code gets signed out. Verified by
 * reading it back before reporting success.
 *
 * Claude Code refreshes the same credential, so a lost race is expected rather
 * than exceptional: on failure we re-read the store, and if the other side
 * already renewed it we simply adopt theirs.
 */
let refreshInFlight = null;
async function refreshCredential(current) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const account = await readAccount();
    let res;
    try {
      res = await fetch(API + '/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken,
          client_id: CLIENT_ID,
        }),
      });
    } catch (e) {
      throw new Error('refresh request failed: ' + e.message);
    }

    if (!res.ok) {
      // Most likely Claude Code spent the same token first. Adopt whatever is
      // in the keychain now instead of treating it as an error.
      const latest = await readCredential().catch(() => null);
      if (latest && latest.refreshToken !== current.refreshToken) return latest;
      throw new Error(`token refresh rejected (HTTP ${res.status})`);
    }

    const tok = await res.json();
    const updated = {
      ...current,
      accessToken: tok.access_token || current.accessToken,
      refreshToken: tok.refresh_token || current.refreshToken,
      expiresAt: Date.now() + (tok.expires_in ? tok.expires_in * 1000 : 3600 * 1000),
    };
    await writeCredential(updated, account);
    const back = await readCredential();
    if (back.accessToken !== updated.accessToken) {
      throw new Error('keychain write-back could not be verified');
    }
    return updated;
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function apiGet(path, token) {
  const res = await fetch(API + path, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'anthropic-beta': OAUTH_BETA,
      'User-Agent': 'claude-hud',
    },
  });
  if (!res.ok) {
    const e = new Error(`${path} -> HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

/** Pull the row the HUD cares about out of the `limits` array. */
function pickLimit(limits, kind) {
  if (!Array.isArray(limits)) return null;
  const row = limits.find(l => l && l.kind === kind);
  if (!row) return null;
  return {
    percent: typeof row.percent === 'number' ? row.percent : null,
    severity: row.severity || 'normal',
    resetsAt: row.resets_at || null,
    isActive: !!row.is_active,
  };
}

const RENEW_MARGIN_MS = 120000;   // renew slightly early rather than on a 401

async function validCredential() {
  let cred = await readCredential();
  if (cred.expiresAt && cred.expiresAt - RENEW_MARGIN_MS < Date.now()) {
    cred = await refreshCredential(cred);
  }
  return cred;
}

async function fetchQuota() {
  const cred = await validCredential();
  const usage = await apiGet('/api/oauth/usage', cred.accessToken);

  const extra = usage.extra_usage || {};
  return {
    ok: true,
    fetchedAt: Date.now(),
    plan: cred.subscriptionType || null,        // "max" | "pro" | ...
    rateLimitTier: cred.rateLimitTier || null,
    session: pickLimit(usage.limits, 'session'),
    weeklyAll: pickLimit(usage.limits, 'weekly_all'),
    weeklyScoped: pickLimit(usage.limits, 'weekly_scoped'),
    extraUsage: extra.is_enabled ? {
      utilization: extra.utilization,
      monthlyLimit: extra.monthly_limit,
      usedCredits: extra.used_credits,
      currency: extra.currency,
    } : null,
  };
}

/** Account identity — cheap, changes almost never, so callers should cache it. */
async function fetchProfile() {
  const cred = await validCredential();
  const p = await apiGet('/api/oauth/profile', cred.accessToken);
  const acct = p.account || {};
  return {
    email: acct.email || null,
    displayName: acct.display_name || acct.full_name || null,
    plan: acct.has_claude_max ? 'Max' : (acct.has_claude_pro ? 'Pro' : null),
    rateLimitTier: (p.organization || {}).rate_limit_tier || null,
  };
}

module.exports = { fetchQuota, fetchProfile, readCredential, refreshCredential };
