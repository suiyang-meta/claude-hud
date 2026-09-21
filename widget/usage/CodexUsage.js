'use strict';
/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
/**
 * CodexUsage — Codex's rate-limit windows via Codex's own ChatGPT sign-in.
 *
 * Borrows the session Codex keeps in ~/.codex/auth.json and asks the same
 * endpoint Codex asks. The usage endpoint is an undocumented internal; treat
 * every field as optional.
 *
 * It also renews that session when it is about to expire, because nothing else
 * on the machine will: the access token lives about ten days, and the Codex CLI
 * only renews it while it is running — which on a machine that has the file but
 * not the CLI is never. Read-only was the safer design right up until the rows
 * went stale on their own with no Codex to open.
 *
 * Approach learned from github.com/vinzdg/codenotch (MIT); this is our own code.
 */
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

const ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage';
// Published at https://auth.openai.com/.well-known/openid-configuration.
const TOKEN_ENDPOINT = 'https://auth.openai.com/api/accounts/oauth/token';
// Codex's own OAuth client. Read from the stored token's claims where possible,
// so a client change follows the file rather than this constant.
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const RENEW_MARGIN_MS = 3600000;   // renew an hour early rather than on a 401

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function authPath() { return path.join(codexHome(), 'auth.json'); }

/** A JWT's payload, or null — used only for `exp` and `client_id`. */
function claims(jwt) {
  try { return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString()); }
  catch { return null; }
}

async function readCredential() {
  let raw;
  try { raw = await fsp.readFile(authPath(), 'utf8'); }
  catch { const e = new Error('Codex is not signed in on this machine'); e.absent = true; throw e; }
  let auth;
  try { auth = JSON.parse(raw); } catch { throw new Error('~/.codex/auth.json is not JSON'); }
  const t = auth && auth.tokens;
  if (!t || !t.access_token || !t.account_id) {
    // API-key mode has no ChatGPT plan and therefore no rate-limit windows.
    const e = new Error('Codex is not signed in with ChatGPT'); e.absent = true; throw e;
  }
  return { auth, token: t.access_token, refresh: t.refresh_token || '', accountId: t.account_id };
}

/**
 * Rewrite only the token section, preserving every other key in the file, and
 * land it atomically — Codex reads this file too, and a half-written one signs
 * it out.
 */
async function writeCredential(auth, tokens) {
  const p = authPath();
  const next = { ...auth, tokens: { ...auth.tokens, ...tokens },
                 last_refresh: new Date().toISOString() };
  const tmp = p + '.hud-tmp';
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, p);
  return next;
}

/**
 * Exchange the refresh token for a fresh access token.
 *
 * OpenAI may rotate the refresh token, so the result MUST land back in the file
 * or Codex is signed out; it is read back before the new token is reported.
 * The Codex CLI refreshes the same file, so a lost race is expected rather than
 * exceptional: on failure we re-read, and if it already renewed we adopt that.
 */
let refreshInFlight = null;
function refreshCredential(cred) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    if (!cred.refresh) throw new Error('no refresh token in ~/.codex/auth.json');
    const c = claims(cred.token) || {};
    let res;
    try {
      res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: cred.refresh,
          client_id: c.client_id || CLIENT_ID,
          scope: 'openid profile email offline_access',
        }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) { throw new Error('Codex token refresh failed: ' + e.message); }

    if (!res.ok) {
      // Most likely Codex itself spent the same token first.
      const latest = await readCredential().catch(() => null);
      if (latest && latest.refresh !== cred.refresh) return latest;
      const e = new Error('Codex token refresh rejected (HTTP ' + res.status + ')');
      e.status = res.status;
      throw e;
    }

    const tok = await res.json();
    if (!tok.access_token) throw new Error('Codex token refresh returned no access token');
    await writeCredential(cred.auth, {
      access_token: tok.access_token,
      // Absent means it was not rotated: keep the one we still hold.
      refresh_token: tok.refresh_token || cred.refresh,
      ...(tok.id_token ? { id_token: tok.id_token } : {}),
    });
    const back = await readCredential();
    if (back.token !== tok.access_token) {
      throw new Error('~/.codex/auth.json write-back could not be verified');
    }
    return back;
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function validCredential() {
  const cred = await readCredential();
  const exp = (claims(cred.token) || {}).exp;
  if (cred.refresh && typeof exp === 'number'
      && exp * 1000 - RENEW_MARGIN_MS < Date.now()) {
    return refreshCredential(cred);
  }
  return cred;
}

/** One window, or null if it is missing or unreadable — never throws. */
function toWindow(w) {
  if (!w || typeof w.used_percent !== 'number') return null;
  let resetsAt = null;
  if (typeof w.reset_at === 'number') resetsAt = new Date(w.reset_at * 1000).toISOString();
  else if (typeof w.reset_after_seconds === 'number') {
    resetsAt = new Date(Date.now() + w.reset_after_seconds * 1000).toISOString();
  }
  const pct = Math.max(0, Math.min(100, Math.round(w.used_percent)));
  return {
    percent: pct,
    severity: pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'normal',
    resetsAt,
    windowSeconds: typeof w.limit_window_seconds === 'number' ? w.limit_window_seconds : null,
  };
}

async function fetchQuota() {
  const cred = await validCredential();
  const res = await fetch(ENDPOINT, {
    headers: {
      Authorization: 'Bearer ' + cred.token,
      'ChatGPT-Account-Id': cred.accountId,
      Accept: 'application/json',
      'User-Agent': 'hud-for-claude',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const e = new Error('Codex usage HTTP ' + res.status);
    e.status = res.status;
    throw e;
  }
  const j = await res.json();
  const rl = j.rate_limit || {};
  const primary = toWindow(rl.primary_window);
  const secondary = toWindow(rl.secondary_window);
  if (!primary && !secondary) throw new Error('Codex usage reply had no readable window');
  return {
    ok: true,
    fetchedAt: Date.now(),
    plan: typeof j.plan_type === 'string' ? j.plan_type : null,
    email: typeof j.email === 'string' ? j.email : null,
    limitReached: !!rl.limit_reached,
    // Codex's primary is its 5-hour window and secondary its weekly one; the
    // labels come from the window length so a plan change cannot mislabel them.
    primary,
    secondary,
  };
}

module.exports = { fetchQuota, readCredential, refreshCredential };
