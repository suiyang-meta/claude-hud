// PetStateMachine — translates quota / interaction events into Codex pet states.
// Runs in main process. Owns timers; pushes state name + bubble text via callbacks.
//
// Layers (from blueprint v5 附录 D, with spec修正 from session 06 inspect):
//   - Background tick: every ~5-15s in comfy mode (baseline shuffle); sticky in
//     stressed/failed mode. Picks idle / waiting / occasional wave / jump.
//   - Reactive events: usage update (may trigger warning flash), drag, pet click.
//   - Review prompt: random 5-60 min timer triggers a `review` state + bubble.
//     Click pet resets the interval.
//
// Override pattern: reactive events set `_overrideUntil = now + holdMs`. The
// background tick respects this and won't replace the state until override
// expires. This gives transient events (drag, click, warning flash) priority
// over baseline without blocking it forever.

const { STATE } = require('./PetFormat');

const BUBBLE_POOL = ['pet me', 'hii', '👋', 'psst...', 'hey', '🐾'];

// Per-mode shuffle tables. Each table is a weighted pool the background tick
// picks from. Each pick lasts a random duration before another pick fires.
//
// Boss spec: 70% time on the anchored animation, 30% on secondary/variety.
//   Comfy   → idle 70%, waiting 20%, wave 5%, jump 5%
//   Anxious → running 70%, failed 30%
//   Fatigue → failed sticky 100% (handled via _stickyState, not a shuffle)
const COMFY_SHUFFLE = [
  { state: STATE.IDLE,    weight: 70, minMs: 8000,  maxMs: 18000 },
  { state: STATE.WAITING, weight: 20, minMs: 4000,  maxMs: 9000 },
  { state: STATE.WAVING,  weight: 5,  minMs: 1500,  maxMs: 2500 },
  { state: STATE.JUMPING, weight: 5,  minMs: 1500,  maxMs: 2500 },
];
const ANXIOUS_SHUFFLE = [
  { state: STATE.RUNNING, weight: 70, minMs: 5000,  maxMs: 12000 },
  { state: STATE.FAILED,  weight: 30, minMs: 1500,  maxMs: 3500 },
];

const REVIEW_MIN_MS    = 5  * 60 * 1000;
const REVIEW_MAX_MS    = 60 * 60 * 1000;
const REVIEW_BUBBLE_MS = 2500;
const REVIEW_HOLD_MS   = 4000;
const POKE_HOLD_MS     = 1200;
// Hold long enough to cover natural pauses inside a slow drag (macOS doesn't
// emit move events continuously when the user inches the window carefully —
// gaps of 100-180ms are common). If override expires inside one of those
// gaps, _tick fires the comfy shuffle and the pet visibly flicks to
// idle/wave/jump — looks like "random jumping" during drag.
const DRAG_HOLD_MS     = 250;
const FAIL_FLASH_MS    = 1500;

function pickWeighted(items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = Math.random() * total;
  for (const it of items) { r -= it.weight; if (r <= 0) return it; }
  return items[0];
}
function randRange(min, max) { return Math.floor(min + Math.random() * (max - min)); }

class PetStateMachine {
  constructor({ emitState, emitBubble }) {
    this.emitState = emitState;
    this.emitBubble = emitBubble;
    this.usageData = null;
    this.current = null;          // null so first _setState emits, even if it's IDLE
    this._overrideUntil = 0;
    this._tickTimer = null;
    this._reviewTimer = null;
    this._lastWarningFlash = 0;
  }

  start() {
    // Idempotent: stop any pre-existing timers so restart after stop() is safe.
    this.stop();
    this.current = null;            // force a fresh emit on first _setState
    this._overrideUntil = 0;
    this._setState(STATE.IDLE, 0);
    this._tick();
    this._scheduleReview();
  }

  stop() {
    if (this._tickTimer) { clearTimeout(this._tickTimer); this._tickTimer = null; }
    if (this._reviewTimer) { clearTimeout(this._reviewTimer); this._reviewTimer = null; }
  }

  // Latest extension WS data. Shape: { found, session, weekly_all, daily_routines, extra_usage, ... }
  onUsageUpdate(data) {
    const prevSticky  = this._stickyState();
    const prevShuffle = this._currentShuffle();
    this.usageData = data;
    const nextSticky  = this._stickyState();
    const nextShuffle = this._currentShuffle();

    // Warning flash when secondary quotas cross 95%, separate from session/weekly stickies.
    // Throttle to once per minute so a flapping value doesn't strobe.
    if (nextSticky !== STATE.FAILED && data && data.found) {
      const r = data.daily_routines && data.daily_routines.percent;
      const e = data.extra_usage && data.extra_usage.percent;
      const tripped = (typeof r === 'number' && r >= 95) || (typeof e === 'number' && e >= 95);
      if (tripped && Date.now() - this._lastWarningFlash > 60 * 1000) {
        this._lastWarningFlash = Date.now();
        this._setState(STATE.FAILED, FAIL_FLASH_MS);
      }
    }

    if (Date.now() < this._overrideUntil) return;   // user interaction in progress; let tick handle it later

    // Mode transition: re-tick immediately so the pet doesn't linger on a stale
    // shuffle pick when quota crosses a threshold (comfy↔anxious↔fatigue).
    if (prevSticky !== nextSticky) {
      if (nextSticky) {
        this._setState(nextSticky, 0);
        return;
      }
      // Sticky → no-sticky (back into a shuffle mode): re-tick immediately
    } else if (prevShuffle === nextShuffle) {
      return;   // no mode change, nothing to do
    }
    if (this._tickTimer) clearTimeout(this._tickTimer);
    this._tick();
  }

  // Fatigue = sticky failed (no secondary). Other modes drive a shuffle table.
  _stickyState() {
    const d = this.usageData;
    if (!d || !d.found) return null;
    const session = typeof d.session === 'number' ? d.session : 0;
    const weekly  = typeof d.weekly_all === 'number' ? d.weekly_all : 0;
    if (session >= 95 || weekly >= 85) return STATE.FAILED;
    return null;
  }

  // Pick the shuffle table for the current mode. Null when sticky takes over.
  _currentShuffle() {
    const d = this.usageData;
    if (!d || !d.found) return COMFY_SHUFFLE;
    const session = typeof d.session === 'number' ? d.session : 0;
    if (session >= 80) return ANXIOUS_SHUFFLE;
    return COMFY_SHUFFLE;
  }

  // Unified background loop. Sticky if fatigue, else shuffle from current mode.
  // Respects override window so transient events keep priority.
  _tick() {
    const now = Date.now();
    if (now < this._overrideUntil) {
      // Re-check very soon after override expires — keeps drag-stop snap-back tight.
      this._tickTimer = setTimeout(() => this._tick(), Math.max(20, this._overrideUntil - now + 10));
      return;
    }
    const sticky = this._stickyState();
    if (sticky) {
      this._setState(sticky, 0);
      this._tickTimer = setTimeout(() => this._tick(), 5000);   // re-check sticky periodically
    } else {
      const pick = pickWeighted(this._currentShuffle());
      this._setState(pick.state, 0);
      this._tickTimer = setTimeout(() => this._tick(), randRange(pick.minMs, pick.maxMs));
    }
  }

  _scheduleReview() {
    const delay = randRange(REVIEW_MIN_MS, REVIEW_MAX_MS);
    this._reviewTimer = setTimeout(() => {
      this._setState(STATE.REVIEW, REVIEW_HOLD_MS);
      this.emitBubble({
        text: BUBBLE_POOL[Math.floor(Math.random() * BUBBLE_POOL.length)],
        durationMs: REVIEW_BUBBLE_MS,
      });
      this._scheduleReview();
    }, delay);
  }

  onPetClick() {
    // Reset review interval (click satisfies the 讨戳 timer)
    if (this._reviewTimer) clearTimeout(this._reviewTimer);
    this._scheduleReview();
    const pick = Math.random() < 0.5 ? STATE.WAVING : STATE.JUMPING;
    this._setState(pick, POKE_HOLD_MS);
  }

  // HUD was dragged. deltaX > 0 → moving right.
  // Decaying rolling sum + deadband so per-tick jitter (deltaX flipping sign
  // by 1-2px during a steady drag) doesn't flap state and restart the walk
  // cycle. Direction only flips when accumulated intent crosses ±DEADBAND.
  onDrag(deltaX) {
    this._dragDirSum = (this._dragDirSum || 0) * 0.65 + deltaX;
    const DEADBAND = 1.5;
    let state;
    if (this._dragDirSum > DEADBAND) state = STATE.RUNNING_RIGHT;
    else if (this._dragDirSum < -DEADBAND) state = STATE.RUNNING_LEFT;
    else {
      // In deadband: keep current walking direction if already walking,
      // otherwise default by raw deltaX sign.
      if (this.current === STATE.RUNNING_LEFT)       state = STATE.RUNNING_LEFT;
      else if (this.current === STATE.RUNNING_RIGHT) state = STATE.RUNNING_RIGHT;
      else                                            state = deltaX >= 0 ? STATE.RUNNING_RIGHT : STATE.RUNNING_LEFT;
    }
    this._setState(state, DRAG_HOLD_MS);
  }

  // Explicit "drag is over" signal (PetWindow detects HUD has been idle 50ms).
  // Force-clears the override so baseline picks up immediately — no waiting
  // for DRAG_HOLD_MS to expire. This is the only way to get truly zero linger.
  onDragEnd() {
    this._overrideUntil = 0;
    this._dragDirSum = 0;
    if (this._tickTimer) clearTimeout(this._tickTimer);
    this._tick();
  }

  _setState(state, holdMs) {
    if (holdMs > 0) this._overrideUntil = Date.now() + holdMs;
    if (state !== this.current) {
      this.current = state;
      this.emitState(state);
    }
  }
}

module.exports = PetStateMachine;
