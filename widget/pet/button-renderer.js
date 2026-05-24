// button-renderer.js — pet button renderer.
// Shows a tiny preview (first idle frame) of the active pet, or a "+" placeholder.
(() => {
  const btn = document.getElementById('btn');

  // Sprite spec (Codex): 1536x1872 sheet, 192px frame width.
  // Button is 26px → scale = 26/192 → sheet scaled = 208x... background-position 0 0.
  const SHEET_W = 1536;
  const FRAME_W = 192;
  const BTN_PX = 26;

  function setPet(pet) {
    if (pet && pet.spritesheetPath) {
      btn.classList.remove('empty');
      btn.textContent = '';
      const url = 'file://' + encodeURI(pet.spritesheetPath);
      btn.style.backgroundImage = `url("${url}")`;
      const scaledW = Math.round(SHEET_W * (BTN_PX / FRAME_W));
      btn.style.backgroundSize = `${scaledW}px auto`;
    } else {
      btn.classList.add('empty');
      btn.textContent = '+';
      btn.style.backgroundImage = '';
    }
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.buttonAPI.click();
  });

  window.buttonAPI.onActivePet(setPet);
  window.buttonAPI.onHoverChange((revealed) => {
    document.body.classList.toggle('revealed', !!revealed);
  });
  window.buttonAPI.ready();
})();
