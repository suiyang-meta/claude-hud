// PetFormat — abstract adapter layer for pet packages.
//
// HUD treats pet packages format-agnostic. Each format (Codex .codex-pet.zip,
// future formats) implements an adapter that produces a normalized Pet object.
//
// State names use the Codex spec vocabulary because it's the only format we
// support today. If a future format uses different state names, its adapter
// translates into this set.

const STATE = Object.freeze({
  IDLE: 'idle',
  RUNNING_RIGHT: 'running-right',
  RUNNING_LEFT: 'running-left',
  WAVING: 'waving',
  JUMPING: 'jumping',
  FAILED: 'failed',
  WAITING: 'waiting',
  RUNNING: 'running',        // abstract task work / focus, NOT physical movement
  REVIEW: 'review',
});

// Official Codex pet spritesheet row mapping (fixed by spec, not declared in pet.json).
const CODEX_ROW_BY_STATE = Object.freeze({
  [STATE.IDLE]: 0,
  [STATE.RUNNING_RIGHT]: 1,
  [STATE.RUNNING_LEFT]: 2,
  [STATE.WAVING]: 3,
  [STATE.JUMPING]: 4,
  [STATE.FAILED]: 5,
  [STATE.WAITING]: 6,
  [STATE.RUNNING]: 7,
  [STATE.REVIEW]: 8,
});

// Normalized Pet object shape (what every adapter must produce):
//
// {
//   id:             string  unique id, used as folder name
//   displayName:    string
//   description:    string
//   kind:           string  e.g. 'animal'
//   format:         string  adapter id, e.g. 'codex'
//   installDir:     string  abs path of installed pet folder
//   spritesheetPath:string  abs path to spritesheet (webp/png)
//   frameWidth:     number  px
//   frameHeight:    number  px
//   framesPerRow:   number
//   rows:           number
//   rowByState:     { [STATE.x]: rowIndex }   // which sheet row plays which state
// }

const adapters = new Map();   // format id -> adapter module
function registerAdapter(adapter) {
  if (!adapter.ID) throw new Error('Adapter missing ID');
  adapters.set(adapter.ID, adapter);
}
function getAdapter(id) { return adapters.get(id); }

// Pick an adapter for a user-supplied path (zip or folder). Caller decides
// which adapter based on extension hint or content; default to codex for now
// since it's the only supported format.
function detectAdapter(packagePath) {
  if (packagePath.toLowerCase().endsWith('.codex-pet.zip')) return adapters.get('codex');
  // Fallback: try codex (handles plain folders with pet.json too)
  return adapters.get('codex');
}

module.exports = {
  STATE,
  CODEX_ROW_BY_STATE,
  registerAdapter,
  getAdapter,
  detectAdapter,
};
