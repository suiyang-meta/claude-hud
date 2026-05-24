// library-renderer.js — runs in the pet library popover renderer.
(() => {
  const SLOT_CAP = 6;
  const SHEET_W = 1536, SHEET_H = 1872;     // Codex spec
  const FRAME_W = 192;                       // first column used for preview
  const PREVIEW_SIZE = 56;

  const grid = document.getElementById('grid');
  const count = document.getElementById('count');

  // Cancel propagation to keep clicks inside the popover from blurring it.
  document.addEventListener('mousedown', (e) => e.stopPropagation());

  function buildVacantSlot() {
    const div = document.createElement('div');
    div.className = 'slot vacant';
    div.title = 'Add a pet';
    div.innerHTML = '<span class="vacant-mark">+</span>';
    div.addEventListener('click', () => window.libraryAPI.importSlot());
    return div;
  }

  function buildPetSlot(pet, isActive) {
    const div = document.createElement('div');
    div.className = 'slot' + (isActive ? ' active' : '');
    div.title = pet.displayName;

    const preview = document.createElement('div');
    preview.className = 'preview';
    // First frame of row 0 (idle) as preview
    const scale = PREVIEW_SIZE / FRAME_W;
    preview.style.width = PREVIEW_SIZE + 'px';
    preview.style.height = Math.round(208 * scale) + 'px';
    preview.style.backgroundImage = `url("file://${pet.spritesheetPath}")`;
    preview.style.backgroundSize = `${Math.round(SHEET_W * scale)}px ${Math.round(SHEET_H * scale)}px`;
    preview.style.backgroundPosition = '0 0';
    div.appendChild(preview);

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = pet.displayName;
    div.appendChild(name);

    const removeBtn = document.createElement('div');
    removeBtn.className = 'remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove pet';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.libraryAPI.remove(pet.id);
    });
    div.appendChild(removeBtn);

    div.addEventListener('click', () => {
      // Click active = toggle off (hides pet). Click inactive = make active.
      window.libraryAPI.activate(isActive ? null : pet.id);
    });
    return div;
  }

  function render(state) {
    const { pets, activeId } = state;
    count.textContent = `${pets.length} / ${SLOT_CAP}`;
    grid.innerHTML = '';
    for (let i = 0; i < SLOT_CAP; i++) {
      const pet = pets[i];
      grid.appendChild(pet ? buildPetSlot(pet, pet.id === activeId) : buildVacantSlot());
    }
  }

  window.libraryAPI.onState(render);
  window.libraryAPI.ready();
})();
