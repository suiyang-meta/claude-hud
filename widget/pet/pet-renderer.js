// pet-renderer.js — runs in the pet BrowserWindow's renderer process.
// Loads a spritesheet, listens to IPC for state changes, draws frames at 8fps.

(() => {
  const canvas = document.getElementById('pet');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;   // pixel art: no bilinear smoothing
  const bubble = document.getElementById('bubble');

  // Default rate matches Codex pet feel (~8fps). Walking states run at 6fps
  // because the running-left/right rows in most Codex pets (incl. Claw'd) are
  // just 2 alternating poses (legs-open / legs-closed); any framerate makes
  // that strobe, but slower = less harsh, more like deliberate footsteps.
  const FRAME_INTERVAL_DEFAULT_MS = 125;
  const FRAME_INTERVAL_WALK_MS = 167;
  const WALK_STATES = new Set(['running-left', 'running-right']);

  // Pet runtime state
  let pet = null;                       // { spritesheetPath, frameWidth, ..., rowByState }
  let img = null;                       // HTMLImageElement of spritesheet
  let framesPerRow = null;              // detected non-empty frame count per row
  let currentState = 'idle';            // current animation row state name
  let currentRow = 0;
  let frameIndex = 0;
  let lastFrameTime = 0;
  let bubbleTimer = null;

  // Scan the spritesheet once after load. For each row, find the rightmost
  // non-empty frame (any pixel with alpha > 0). Codex spec says all 9 rows are
  // required, but artists sometimes ship partial sheets; without this, we'd
  // cycle into transparent frames and the pet would flash empty.
  function detectFramesPerRow(image) {
    const off = document.createElement('canvas');
    off.width = image.naturalWidth;
    off.height = image.naturalHeight;
    const offCtx = off.getContext('2d');
    offCtx.drawImage(image, 0, 0);

    const result = new Array(pet.rows).fill(0);
    for (let row = 0; row < pet.rows; row++) {
      for (let col = pet.framesPerRow - 1; col >= 0; col--) {
        const data = offCtx.getImageData(
          col * pet.frameWidth, row * pet.frameHeight,
          pet.frameWidth, pet.frameHeight
        ).data;
        let hasContent = false;
        // Step by 16 (4 pixels) for speed — any 1 lit pixel is enough.
        for (let i = 3; i < data.length; i += 16) {
          if (data[i] > 0) { hasContent = true; break; }
        }
        if (hasContent) { result[row] = col + 1; break; }
      }
    }
    return result;
  }

  function resolveRow(state) {
    let row = pet.rowByState[state];
    if (row === undefined) return null;
    if (framesPerRow && framesPerRow[row] === 0) {
      // Row is empty in this pet — fall back to idle
      const idleRow = pet.rowByState['idle'];
      if (idleRow !== undefined && framesPerRow[idleRow] > 0) return idleRow;
      return null;
    }
    return row;
  }

  function setState(state) {
    if (!pet) return;
    const row = resolveRow(state);
    if (row === null) return;
    if (state === currentState && row === currentRow) return;
    currentState = state;
    currentRow = row;
    // Keep frameIndex as-is across state changes. Don't reset lastFrameTime
    // either — frames must advance on a uniform schedule regardless of how
    // often state flips, otherwise rapid state changes (e.g. drag direction
    // jitter) starve the animation and it looks frozen / "skippy".
    if (framesPerRow && frameIndex >= (framesPerRow[currentRow] || 1)) {
      frameIndex = 0;
    }
    draw();
  }

  function draw() {
    if (!img || !pet) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sx = frameIndex * pet.frameWidth;
    const sy = currentRow * pet.frameHeight;
    ctx.drawImage(
      img,
      sx, sy, pet.frameWidth, pet.frameHeight,
      0, 0, canvas.width, canvas.height
    );
  }

  function tick(now) {
    if (img && pet) {
      const interval = WALK_STATES.has(currentState) ? FRAME_INTERVAL_WALK_MS : FRAME_INTERVAL_DEFAULT_MS;
      if (now - lastFrameTime >= interval) {
        const maxFrames = (framesPerRow && framesPerRow[currentRow]) || pet.framesPerRow;
        frameIndex = (frameIndex + 1) % Math.max(1, maxFrames);
        lastFrameTime = now;
        draw();
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function loadPet(petData) {
    pet = petData;
    framesPerRow = null;
    img = new Image();
    img.onload = () => {
      framesPerRow = detectFramesPerRow(img);
      // Re-resolve current row in case current state's row is empty
      const fallbackRow = resolveRow(currentState);
      currentRow = fallbackRow !== null ? fallbackRow : 0;
      frameIndex = 0;
      draw();
    };
    img.onerror = () => {
      window.petAPI && window.petAPI.spriteLoadFailed(pet.id);
    };
    img.src = 'file://' + encodeURI(pet.spritesheetPath);
  }

  function showBubble(text, durationMs = 2500) {
    bubble.textContent = text;
    bubble.classList.add('show');
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => {
      bubble.classList.remove('show');
      bubbleTimer = null;
    }, durationMs);
  }

  // Pet click → send to main, StateMachine reacts
  canvas.addEventListener('click', (e) => {
    e.stopPropagation();
    window.petAPI && window.petAPI.clicked();
  });

  // IPC bridge from main process
  if (window.petAPI) {
    window.petAPI.onPetLoad((petData) => loadPet(petData));
    window.petAPI.onStateChange((state) => setState(state));
    window.petAPI.onBubble(({ text, durationMs }) => showBubble(text, durationMs));
    window.petAPI.rendererReady();
  } else {
    console.error('[pet-renderer] petAPI not exposed — preload missing?');
  }
})();
