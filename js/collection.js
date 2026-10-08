/* Grille de collection : affichage plat, filtres, mode recyclage. */
(function (root) {
  'use strict';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* opts :
   *   grid, emptyEl, ownedCount,
   *   typeFilter, rarityFilter, recycleToggle,
   *   recycleBar, recycleSummary, recycleGain, recycleClear, recycleBtn,
   *   cards        : toutes les cartes triées par identifiant
   *   storage      : store SFCStorage
   *   onInspect(card)      : clic sur une carte (hors recyclage)
   *   onRecycle(cardIds[]) : demande de recyclage (copie par id) */
  function create(opts) {
    var selected = {}; // cardId -> nombre de copies sélectionnées
    var recycleMode = false;
    var typeSel = '';
    var raritySel = '';

    function ownedOf(id) {
      return opts.storage.getState().collection[id] || 0;
    }

    function ownedCards() {
      return opts.cards.filter(function (card) {
        return ownedOf(card.id) > 0;
      });
    }

    function filteredCards() {
      return ownedCards().filter(function (card) {
        if (typeSel && card.type.slug !== typeSel) return false;
        if (raritySel && card.rarity.slug !== raritySel) return false;
        return true;
      });
    }

    function initFilters() {
      var types = {};
      var rarities = {};
      opts.cards.forEach(function (card) {
        types[card.type.slug] = card.type.label;
        rarities[card.rarity.slug] = card.rarity.label;
      });

      Object.keys(types).sort().forEach(function (slug) {
        var o = document.createElement('option');
        o.value = slug;
        o.textContent = types[slug];
        opts.typeFilter.appendChild(o);
      });

      var order = ['commune', 'inhabituelle', 'rare', 'ultra-rare',
        'promotionnelle', 'se', 'secret-rare'];
      order.filter(function (s) { return rarities[s]; }).forEach(function (slug) {
        var o = document.createElement('option');
        o.value = slug;
        o.textContent = rarities[slug];
        opts.rarityFilter.appendChild(o);
      });
    }

    function selectionTotal() {
      var total = 0;
      Object.keys(selected).forEach(function (id) { total += selected[id]; });
      return total;
    }

    function selectionIds() {
      var ids = [];
      Object.keys(selected).forEach(function (id) {
        for (var i = 0; i < selected[id]; i++) ids.push(id);
      });
      return ids;
    }

    function updateRecycleBar() {
      var total = selectionTotal();
      var gain = 0;
      Object.keys(selected).forEach(function (id) {
        var card = opts.cards.find(function (c) { return c.id === id; });
        if (card) {
          gain += (opts.storage.RECYCLE_GAINS[card.rarity.slug] || 0) * selected[id];
        }
      });

      opts.recycleSummary.textContent = total === 0
        ? 'Aucune carte sélectionnée'
        : total + (total > 1 ? ' cartes sélectionnées' : ' carte sélectionnée');
      opts.recycleGain.textContent = gain > 0 ? 'Gain : +' + fmtDuration(gain) : '';
      opts.recycleBtn.disabled = total === 0;
    }

    function updateOwnedCount() {
      var owned = ownedCards();
      var copies = 0;
      owned.forEach(function (card) { copies += ownedOf(card.id); });
      opts.ownedCount.textContent =
        owned.length + '/' + opts.cards.length + ' cartes · ' +
        copies + (copies > 1 ? ' exemplaires' : ' exemplaire');
    }

    function buildTile(card) {
      var count = ownedOf(card.id);
      var sel = selected[card.id] || 0;

      var tile = el('button', 'card-tile r-' + card.rarity.slug);
      tile.type = 'button';
      tile.dataset.id = card.id;
      if (recycleMode && sel > 0) tile.classList.add('selected');
      tile.title = card.name + ' — ' + card.rarity.label;

      var img = document.createElement('img');
      img.src = card.imagePath;
      img.alt = card.name;
      img.loading = 'lazy';
      tile.appendChild(img);

      var countBadge = el('span', 'card-count',
        recycleMode && sel > 0 ? sel + '/' + count : '×' + count);
      tile.appendChild(countBadge);
      tile.appendChild(el('span', 'card-num', '#' + String(card.number).padStart(3, '0')));
      tile.appendChild(el('span', 'card-check'));

      return tile;
    }

    function render() {
      var cards = filteredCards();
      opts.grid.textContent = '';
      cards.forEach(function (card) {
        opts.grid.appendChild(buildTile(card));
      });
      opts.emptyEl.classList.toggle('hidden', ownedCards().length !== 0);
      updateOwnedCount();
      updateRecycleBar();
    }

    initFilters();

    opts.grid.addEventListener('click', function (event) {
      var tile = event.target.closest('.card-tile');
      if (!tile) return;
      var id = tile.dataset.id;
      var card = opts.cards.find(function (c) { return c.id === id; });
      if (!card) return;

      if (recycleMode) {
        var count = ownedOf(id);
        selected[id] = ((selected[id] || 0) + 1) % (count + 1);
        if (selected[id] === 0) delete selected[id];
        render();
        return;
      }
      opts.onInspect(card);
    });

    opts.typeFilter.addEventListener('change', function () {
      typeSel = opts.typeFilter.value;
      render();
    });
    opts.rarityFilter.addEventListener('change', function () {
      raritySel = opts.rarityFilter.value;
      render();
    });

    opts.recycleToggle.addEventListener('change', function () {
      recycleMode = opts.recycleToggle.checked;
      opts.grid.classList.toggle('recycle-mode', recycleMode);
      opts.recycleBar.classList.toggle('hidden', !recycleMode);
      if (!recycleMode) selected = {};
      render();
    });

    opts.recycleClear.addEventListener('click', function () {
      selected = {};
      render();
    });

    opts.recycleBtn.addEventListener('click', function () {
      var ids = selectionIds();
      if (ids.length) opts.onRecycle(ids);
    });

    return {
      refresh: render,
      clearSelection: function () {
        selected = {};
        render();
      },
      getSelection: function () { return selectionIds(); },

      /* Une copie de chaque carte est conservée : renvoie tous les
       * exemplaires au-delà du premier, pour chaque carte possédée. */
      getDuplicateIds: function () {
        var ids = [];
        ownedCards().forEach(function (card) {
          var count = ownedOf(card.id);
          for (var i = 1; i < count; i++) ids.push(card.id);
        });
        return ids;
      }
    };
  }

  function fmtDuration(ms) {
    var totalSec = Math.round(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + ' h ' + String(m).padStart(2, '0') + ' min';
    if (m > 0) return m + ' min ' + String(s).padStart(2, '0') + ' s';
    return s + ' s';
  }

  root.SFCCollection = { create: create, fmtDuration: fmtDuration };
})(typeof window !== 'undefined' ? window : globalThis);
