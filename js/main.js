/* Orchestration : chargement des sets, navigation, ouverture, recyclage. */
(function () {
  'use strict';

  var storage = window.SFCStorage.browser;
  var pool = { cards: [], byId: {} };
  var collection = null;
  var inspect = null;
  var currentView = 'boosters';

  /* ---------- Chargement des sets (compatible file://) ---------- */

  function loadSetScripts(done) {
    var list = window.SET_LIST || [];
    if (!list.length) { done(); return; }
    var pending = list.length;
    list.forEach(function (entry) {
      var script = document.createElement('script');
      script.src = 'assets/sets/' + entry.slug + '/cards.js';
      script.onload = script.onerror = function () {
        pending--;
        if (pending === 0) done();
      };
      document.head.appendChild(script);
    });
  }

  function buildPool() {
    var missing = [];
    (window.SET_LIST || []).forEach(function (entry) {
      var payload = (window.SETS || {})[entry.slug];
      if (!payload) { missing.push(entry.slug); return; }
      payload.cards.forEach(function (card) {
        pool.cards.push(Object.assign({}, card, {
          setSlug: payload.setSlug,
          setNumber: payload.setNumber,
          setName: payload.setName,
          imagePath: 'assets/sets/' + payload.setSlug + '/' + card.image
        }));
      });
    });
    pool.cards.sort(function (a, b) {
      return (a.setNumber - b.setNumber) || (a.number - b.number);
    });
    pool.cards.forEach(function (card) { pool.byId[card.id] = card; });
    if (missing.length) {
      toast('Sets introuvables : ' + missing.join(', '));
    }
    if (!pool.cards.length) {
      toast('Aucune carte chargée — vérifie assets/sets/');
    }
  }

  /* ---------- Utilitaires ---------- */

  function $(id) { return document.getElementById(id); }

  function fmtClock(ms) {
    var totalSec = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }

  var toastTimer = null;
  function toast(message) {
    var node = $('toast');
    node.textContent = message;
    node.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.add('hidden'); }, 3500);
  }

  /* ---------- Mise à jour de l'état visible ---------- */

  function updateStatus() {
    var snap = storage.tick();
    var full = snap.boosters >= storage.MAX_BOOSTERS;

    $('booster-count').textContent = snap.boosters;
    $('booster-pill').classList.toggle('full', full);

    var pill = $('timer-pill');
    pill.classList.toggle('paused', full && snap.remainingMs > 0);
    pill.classList.toggle('ready', !full && snap.remainingMs <= 1000);
    $('timer-text').textContent = full
      ? 'Cap atteint · ' + snap.boosters + '/3'
      : fmtClock(snap.remainingMs);

    $('next-time').textContent = fmtClock(snap.remainingMs);
    $('next-hint').textContent = full
      ? 'Le compte à rebours est figé : il reprendra dès qu\'un booster sera ouvert.'
      : (snap.remainingMs <= 1000
        ? 'Ton booster est prêt !'
        : 'Un nouveau booster toutes les heures.');

    $('open-booster-btn').disabled = snap.boosters <= 0;

    var slots = $('booster-slots');
    slots.textContent = '';
    for (var i = 0; i < storage.MAX_BOOSTERS; i++) {
      var slot = document.createElement('div');
      var filled = i < snap.boosters;
      slot.className = 'booster-slot' + (filled ? ' filled' : '');
      if (filled) {
        slot.appendChild(Object.assign(document.createElement('div'), {
          className: 'pack-art'
        }));
        slot.appendChild(Object.assign(document.createElement('span'), {
          className: 'slot-label',
          textContent: 'Booster'
        }));
        slot.title = 'Ouvrir ce booster';
        (function () { slot.addEventListener('click', openBooster); })();
      } else {
        slot.textContent = 'Vide';
      }
      slots.appendChild(slot);
    }

    var ownedIds = Object.keys(storage.getState().collection);
    $('collection-count').textContent = ownedIds.length || '';
  }

  /* ---------- Ouverture de booster ---------- */

  function openBooster() {
    if (!pool.cards.length) {
      toast('Aucune carte chargée — vérifie assets/sets/');
      return;
    }
    var ids;
    try {
      ids = window.SFCBooster.generate(pool.cards, Math.random);
    } catch (err) {
      console.error(err);
      toast('Ouverture impossible : ' + err.message);
      return;
    }
    if (!storage.consumeBooster()) return;

    var ownedBefore = Object.assign({}, storage.getState().collection);
    storage.addCards(ids);

    var first = pool.byId[ids[0]];
    $('booster-title').textContent = 'Booster ' +
      ((first && first.setName) || 'de cartes');

    var grid = $('booster-grid');
    grid.textContent = '';
    ids.forEach(function (id) {
      var card = pool.byId[id];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'booster-card';
      btn.dataset.id = id;

      var inner = document.createElement('div');
      inner.className = 'booster-card-inner';

      var back = document.createElement('div');
      back.className = 'booster-face booster-back';

      var front = document.createElement('div');
      front.className = 'booster-face booster-front r-' + card.rarity.slug;
      var img = document.createElement('img');
      img.src = card.imagePath;
      img.alt = card.name;
      front.appendChild(img);

      if (!ownedBefore[id]) {
        var badge = document.createElement('span');
        badge.className = 'card-new';
        badge.textContent = 'Nouveau';
        front.appendChild(badge);
      }

      inner.appendChild(back);
      inner.appendChild(front);
      btn.appendChild(inner);
      grid.appendChild(btn);
    });

    updateRevealProgress();
    $('booster-overlay').classList.remove('hidden');
    updateStatus();
    if (collection) collection.refresh();
  }

  function flipCard(cardEl) {
    if (cardEl.classList.contains('flipped')) return;
    cardEl.classList.add('flipped', 'flip-pop');
    updateRevealProgress();
  }

  function updateRevealProgress() {
    var cards = $('booster-grid').querySelectorAll('.booster-card');
    var flipped = $('booster-grid').querySelectorAll('.booster-card.flipped');
    $('booster-progress').textContent = flipped.length + '/' + cards.length + ' révélées';
    $('reveal-all-btn').disabled = flipped.length === cards.length;
  }

  /* ---------- Recyclage ---------- */

  function requestRecycle(ids) {
    var gain = 0;
    var unknown = 0;
    ids.forEach(function (id) {
      var card = pool.byId[id];
      if (!card) { unknown++; return; }
      gain += storage.RECYCLE_GAINS[card.rarity.slug] || 0;
    });
    if (!ids.length || unknown === ids.length) return;

    $('confirm-text').textContent =
      ids.length + (ids.length > 1
        ? ' cartes seront définitivement retirées de ta collection.'
        : ' carte sera définitivement retirée de ta collection.');
    $('confirm-detail').textContent =
      'Gain total : +' + window.SFCCollection.fmtDuration(gain) +
      ' sur le prochain booster.';

    var overlay = $('confirm-overlay');
    overlay.classList.remove('hidden');

    var okBtn = $('confirm-ok');
    var cancelBtn = $('confirm-cancel');
    var cleanup = function () {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', cleanup);
      overlay.removeEventListener('click', onOverlayClick);
    };
    var onOverlayClick = function (event) {
      if (event.target === overlay) cleanup();
    };
    function onOk() {
      cleanup();
      var rarities = ids
        .map(function (id) { return pool.byId[id]; })
        .filter(Boolean)
        .map(function (card) { return card.rarity.slug; });

      var result = storage.recycle(rarities);
      storage.removeCards(ids);
      collection.clearSelection();
      collection.refresh();
      updateStatus();

      if (result.blocked) {
        toast('Cap atteint : le recyclage est inutile pour l\'instant.');
      } else if (result.granted > 0) {
        toast('Recyclé : +' + window.SFCCollection.fmtDuration(result.gainMs) +
          ' — booster gagné !');
      } else {
        toast('Recyclé : +' + window.SFCCollection.fmtDuration(result.gainMs) +
          ' — prochain booster dans ' + fmtClock(storage.getRemainingMs()));
      }
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', cleanup);
    overlay.addEventListener('click', onOverlayClick);
  }

  /* ---------- Navigation ---------- */

  function switchView(name) {
    currentView = name;
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.view === name);
    });
    document.querySelectorAll('.view').forEach(function (view) {
      view.classList.toggle('active', view.id === 'view-' + name);
    });
    if (name === 'collection' && collection) collection.refresh();
  }

  /* ---------- Reset ---------- */

  function setupReset() {
    var btn = $('reset-btn');
    var armed = false;
    var disarmTimer = null;
    btn.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        btn.classList.add('confirm');
        btn.textContent = 'Sûr ? Cette action est définitive.';
        disarmTimer = setTimeout(disarm, 4000);
        return;
      }
      clearTimeout(disarmTimer);
      storage.reset();
      location.reload();
    });
    function disarm() {
      armed = false;
      btn.classList.remove('confirm');
      btn.textContent = 'Réinitialiser la progression';
    }
  }

  /* ---------- Boot ---------- */

  function init() {
    buildPool();

    collection = window.SFCCollection.create({
      grid: $('card-grid'),
      emptyEl: $('collection-empty'),
      ownedCount: $('owned-count'),
      typeFilter: $('filter-type'),
      rarityFilter: $('filter-rarity'),
      recycleToggle: $('recycle-toggle'),
      recycleBar: $('recycle-bar'),
      recycleSummary: $('recycle-summary'),
      recycleGain: $('recycle-gain'),
      recycleClear: $('recycle-clear'),
      recycleBtn: $('recycle-btn'),
      cards: pool.cards,
      storage: storage,
      onInspect: function (card) {
        inspect.open(card, storage.getState().collection[card.id] || 0, card.setName);
      },
      onRecycle: requestRecycle
    });

    inspect = window.SFCInspect.create({
      overlay: $('inspect-overlay'),
      stage: $('inspect-stage'),
      cardEl: $('inspect-card'),
      imgEl: $('inspect-img'),
      glareEl: $('inspect-glare'),
      nameEl: $('inspect-name'),
      rarityEl: $('inspect-rarity'),
      typeEl: $('inspect-type'),
      numEl: $('inspect-number'),
      ownedEl: $('inspect-owned'),
      descEl: $('inspect-desc'),
      closeBtn: $('inspect-close-btn')
    });

    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchView(tab.dataset.view); });
    });

    $('open-booster-btn').addEventListener('click', openBooster);
    $('booster-grid').addEventListener('click', function (event) {
      var cardEl = event.target.closest('.booster-card');
      if (!cardEl) return;
      if (cardEl.classList.contains('flipped')) {
        var card = pool.byId[cardEl.dataset.id];
        if (card) {
          inspect.open(card,
            storage.getState().collection[card.id] || 0, card.setName);
        }
      } else {
        flipCard(cardEl);
      }
    });
    $('reveal-all-btn').addEventListener('click', function () {
      $('booster-grid').querySelectorAll('.booster-card').forEach(flipCard);
    });
    $('booster-close-btn').addEventListener('click', function () {
      $('booster-overlay').classList.add('hidden');
      collection.refresh();
      updateStatus();
    });

    $('recycle-dupes-btn').addEventListener('click', function () {
      if (storage.getState().boosters >= storage.MAX_BOOSTERS) {
        toast('Cap atteint : le recyclage est bloqué jusqu\'à l\'ouverture d\'un booster.');
        return;
      }
      var ids = collection.getDuplicateIds();
      if (!ids.length) {
        toast('Aucun doublon à recycler : tu ne gardes qu\'une copie de chaque carte.');
        return;
      }
      requestRecycle(ids);
    });

    setupReset();
    collection.refresh();
    updateStatus();
    setInterval(updateStatus, 500);

    /* Helpers de debug (test sans attendre le timer réel). */
    window.__sfcards = {
      storage: storage,
      state: storage.getState,
      pool: pool,
      fastForward: function (ms) {
        var s = storage.getState();
        s.cycle.lastTick -= ms;
        updateStatus();
        collection.refresh();
      },
      reset: function () { storage.reset(); location.reload(); }
    };
  }

  loadSetScripts(function () {
    try {
      init();
    } catch (err) {
      console.error(err);
      toast('Erreur d\'initialisation : ' + err.message);
    }
  });
})();
