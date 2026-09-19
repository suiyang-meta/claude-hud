'use strict';
/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
/**
 * CodexUsage — Codex's rate-limit windows via Codex's own ChatGPT sign-in.
 *
 * Borrows the session Codex keeps in ~/.codex/auth.json and asks the same
 * endpoint Codex asks. Read-only: the token is never refreshed or written back,
 * so a 401 just means "open Codex once" — Codex renews it on its own.
 * The endpoint is an undocumented internal; treat every field as optional.
 *
 * Approach learned from github.com/vinzdg/codenotch (MIT); this is our own code.
 */
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

const ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage';

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

async function readCredential() {
  let raw;
  try { raw = await fsp.readFile(path.join(codexHome(), 'auth.json'), 'utf8'); }
  catch { const e = new Error('Codex is not signed in on this machine'); e.absent = true; throw e; }
  let auth;
  try { auth = JSON.parse(raw); } catch { throw new Error('~/.codex/auth.json is not JSON'); }
  const t = auth && auth.tokens;
  if (!t || !t.access_token || !t.account_id) {
    // API-key mode has no ChatGPT plan and therefore no rate-limit windows.
    const e = new Error('Codex is not signed in with ChatGPT'); e.absent = true; throw e;
  }
  return { token: t.access_token, accountId: t.account_id };
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
  const cred = await readCredential();
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

module.exports = { fetchQuota };
