// CodexPetAdapter — loads Codex desktop pet packages (.codex-pet.zip or plain
// folder with pet.json + spritesheet.webp at root).
//
// Spec (verified against black-cat reference 2026-05-24):
//   - Package: zip with pet.json + spritesheet.{webp|png} at ROOT (no wrapper folder)
//   - pet.json fields: id, displayName, description, spritesheetPath, kind
//   - Spritesheet: 1536x1872, 8 cols x 9 rows, 192x208 per frame, transparent
//   - Row order is fixed by spec (see PetFormat.CODEX_ROW_BY_STATE).

const fs = require('fs');
const path = require('path');
const extract = require('extract-zip');
const { STATE, CODEX_ROW_BY_STATE, registerAdapter } = require('./PetFormat');

const ID = 'codex';

const SPEC = {
  frameWidth: 192,
  frameHeight: 208,
  framesPerRow: 8,
  rows: 9,
  totalWidth: 1536,
  totalHeight: 1872,
};

function readManifest(petDir) {
  const manifestPath = path.join(petDir, 'pet.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Codex pet missing pet.json at ${manifestPath}`);
  }
  const raw = fs.readFileSync(manifestPath, 'utf8');
  let m;
  try { m = JSON.parse(raw); }
  catch (e) { throw new Error(`pet.json is not valid JSON: ${e.message}`); }
  for (const field of ['id', 'displayName', 'spritesheetPath']) {
    if (typeof m[field] !== 'string' || !m[field]) {
      throw new Error(`pet.json missing required field "${field}"`);
    }
  }
  return m;
}

// Derive pet id + displayName from a package filename.
//   "the-guy.codex-pet.zip"      → { id: 'the-guy',     displayName: 'The Guy' }
//   "Black_Cat-9e8c8e17.zip"     → { id: 'black-cat-9e8c8e17', displayName: 'Black Cat 9e8c8e17' }
// Sanitizes id to lowercase kebab so it's safe as a filesystem dir name.
function deriveNamesFromFilename(packagePath) {
  let base = path.basename(packagePath);
  base = base.replace(/\.codex-pet\.zip$/i, '').replace(/\.zip$/i, '');
  const id = base.toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const displayName = base
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  return { id: id || 'pet', displayName: displayName || 'Pet' };
}

function buildPet(installDir, manifest) {
  const spritesheetPath = path.join(installDir, manifest.spritesheetPath);
  if (!fs.existsSync(spritesheetPath)) {
    throw new Error(`Spritesheet not found at ${spritesheetPath}`);
  }
  return {
    id: manifest.id,
    displayName: manifest.displayName,
    description: manifest.description || '',
    kind: manifest.kind || 'unknown',
    format: ID,
    installDir,
    spritesheetPath,
    frameWidth: SPEC.frameWidth,
    frameHeight: SPEC.frameHeight,
    framesPerRow: SPEC.framesPerRow,
    rows: SPEC.rows,
    rowByState: { ...CODEX_ROW_BY_STATE },
  };
}

// Install a pet package into petsRoot/<id>/. Returns the Pet object.
// packagePath can be:
//   - a .zip file (will be extracted)
//   - a folder containing pet.json + spritesheet at root
//
// If a pet with the same id already exists in petsRoot, it is overwritten.
// The id used for the folder name is taken from the manifest, not the
// original file name (so user-renamed zips don't break import).
async function install(packagePath, petsRoot) {
  const stat = fs.statSync(packagePath);
  let stagingDir;
  let cleanupStaging = false;

  if (stat.isDirectory()) {
    stagingDir = packagePath;
  } else {
    stagingDir = path.join(petsRoot, `.staging-${Date.now()}`);
    fs.mkdirSync(stagingDir, { recursive: true });
    await extract(packagePath, { dir: stagingDir });
    cleanupStaging = true;
  }

  try {
    const manifest = readManifest(stagingDir);
    // Override id + displayName from package filename (more user-meaningful
    // than the often UUID-tagged manifest id). For folder imports, keep the
    // manifest's own id since there's no zip filename to derive from.
    if (!stat.isDirectory()) {
      const derived = deriveNamesFromFilename(packagePath);
      manifest.id = derived.id;
      manifest.displayName = derived.displayName;
    }
    const targetDir = path.join(petsRoot, manifest.id);

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });
    for (const f of fs.readdirSync(stagingDir)) {
      fs.copyFileSync(path.join(stagingDir, f), path.join(targetDir, f));
    }

    // Persist derived names back into the installed pet.json so subsequent
    // loadInstalled() picks up the same names without needing the original zip.
    fs.writeFileSync(
      path.join(targetDir, 'pet.json'),
      JSON.stringify(manifest, null, 2) + '\n'
    );

    return buildPet(targetDir, manifest);
  } finally {
    if (cleanupStaging && fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }
}

// Load an already-installed pet from petsRoot/<id>/. Cheaper than install
// when the package is already on disk (e.g. on app startup).
function loadInstalled(petDir) {
  const manifest = readManifest(petDir);
  return buildPet(petDir, manifest);
}

const adapter = { ID, install, loadInstalled, SPEC };
registerAdapter(adapter);

module.exports = adapter;
