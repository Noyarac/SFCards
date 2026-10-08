/* Modale d'inspection d'une carte avec effet 3D suivant la souris. */
(function (root) {
  'use strict';

  /* opts : overlay, stage, cardEl, imgEl, glareEl,
   *        nameEl, rarityEl, typeEl, numEl, ownedEl, descEl, closeBtn */
  function create(opts) {
    var openCard = null;

    function applyTilt(clientX, clientY) {
      var rect = opts.stage.getBoundingClientRect();
      var x = (clientX - rect.left) / rect.width - 0.5;
      var y = (clientY - rect.top) / rect.height - 0.5;
      x = Math.max(-0.5, Math.min(0.5, x));
      y = Math.max(-0.5, Math.min(0.5, y));

      var rotateY = x * 22;
      var rotateX = -y * 22;
      opts.cardEl.style.transform =
        'rotateX(' + rotateX.toFixed(2) + 'deg) rotateY(' +
        rotateY.toFixed(2) + 'deg) scale(1.06)';
      opts.glareEl.style.setProperty('--gx', ((x + 0.5) * 100).toFixed(1) + '%');
      opts.glareEl.style.setProperty('--gy', ((y + 0.5) * 100).toFixed(1) + '%');
    }

    function resetTilt() {
      opts.cardEl.style.transform = 'rotateX(0deg) rotateY(0deg)';
    }

    opts.stage.addEventListener('mousemove', function (event) {
      if (!openCard) return;
      applyTilt(event.clientX, event.clientY);
    });
    opts.stage.addEventListener('mouseleave', resetTilt);

    opts.overlay.addEventListener('click', function (event) {
      if (event.target === opts.overlay) close();
    });
    opts.closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && openCard) close();
    });

    function open(card, ownedCount, setLabel) {
      openCard = card;
      opts.imgEl.src = card.imagePath;
      opts.imgEl.alt = card.name;
      opts.nameEl.textContent = card.name;
      opts.rarityEl.textContent = card.rarity.label;
      opts.rarityEl.className = 'rarity-badge r-' + card.rarity.slug;
      opts.typeEl.textContent = card.type.label;
      opts.numEl.textContent = '#' + String(card.number).padStart(3, '0');
      opts.ownedEl.textContent = ownedCount > 1
        ? ownedCount + ' exemplaires' : '1 exemplaire';
      opts.descEl.textContent = setLabel +
        ' · ' + card.type.label + ' · ' + card.rarity.label;
      resetTilt();
      opts.overlay.classList.remove('hidden');
    }

    function close() {
      openCard = null;
      opts.overlay.classList.add('hidden');
      opts.imgEl.removeAttribute('src');
    }

    return { open: open, close: close, isOpen: function () { return !!openCard; } };
  }

  root.SFCInspect = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
