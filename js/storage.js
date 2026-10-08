/* État du jeu : boosters, timer de la prochaine carte, collection.
 * Logique pure (backend de persistance injectable) -> testable sous Node. */
(function (root) {
  'use strict';

  var KEY = 'sfcards.state.v1';
  var CYCLE_MS = 60 * 60 * 1000;
  var MAX_BOOSTERS = 3;

  var RECYCLE_GAINS = {
    commune: 60 * 1000,
    inhabituelle: 3 * 60 * 1000,
    rare: 10 * 60 * 1000,
    'ultra-rare': 30 * 60 * 1000,
    promotionnelle: 30 * 60 * 1000,
    se: 30 * 60 * 1000,
    'secret-rare': 30 * 60 * 1000
  };

  function defaultState(now) {
    return {
      version: 1,
      boosters: 1,
      cycle: { remainingMs: CYCLE_MS, lastTick: now || Date.now(), paused: false },
      collection: {}
    };
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function createStore(backend) {
    var state = null;

    function load() {
      var raw = null;
      try { raw = backend.getItem(KEY); } catch (e) { raw = null; }
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.version === 1 &&
              typeof parsed.boosters === 'number' &&
              parsed.cycle && typeof parsed.cycle.remainingMs === 'number' &&
              parsed.collection && typeof parsed.collection === 'object') {
            state = {
              version: 1,
              boosters: clamp(Math.round(parsed.boosters), 0, MAX_BOOSTERS),
              cycle: {
                remainingMs: parsed.cycle.remainingMs,
                lastTick: typeof parsed.cycle.lastTick === 'number'
                  ? parsed.cycle.lastTick : Date.now(),
                paused: !!parsed.cycle.paused
              },
              collection: {}
            };
            Object.keys(parsed.collection).forEach(function (id) {
              var n = Math.round(parsed.collection[id]);
              if (n > 0) state.collection[id] = n;
            });
            return;
          }
        } catch (e) { /* état corrompu -> réinitialisation */ }
      }
      state = defaultState();
      save();
    }

    function save() {
      try { backend.setItem(KEY, JSON.stringify(state)); } catch (e) { /* quota */ }
    }

    /* Fait avancer le timer jusqu'à `now`.
     * Tant qu'il y a moins de 3 boosters : on consomme le temps écoulé et on
     * accorde des boosters tant que le temps est écoulé.
     * À 3 boosters : le timer est figé (aucun temps ne s'écoule).
     * Si le temps résiduel est négatif au moment du figeage (absence très
     * longue), il est remis à une heure pleine -> jamais de rafale. */
    function advance(now) {
      var c = state.cycle;
      var elapsed = Math.max(0, now - c.lastTick);
      c.lastTick = now;

      if (state.boosters >= MAX_BOOSTERS) {
        if (c.remainingMs <= 0) c.remainingMs = CYCLE_MS;
        c.paused = true;
        return;
      }

      c.paused = false;
      c.remainingMs -= elapsed;
      while (c.remainingMs <= 0 && state.boosters < MAX_BOOSTERS) {
        state.boosters++;
        c.remainingMs += CYCLE_MS;
      }
      if (state.boosters >= MAX_BOOSTERS) {
        c.paused = true;
        if (c.remainingMs <= 0) c.remainingMs = CYCLE_MS;
      }
    }

    var api = {
      CYCLE_MS: CYCLE_MS,
      MAX_BOOSTERS: MAX_BOOSTERS,
      RECYCLE_GAINS: RECYCLE_GAINS,

      getState: function () { return state; },

      tick: function (now) {
        advance(now || Date.now());
        return {
          boosters: state.boosters,
          remainingMs: state.cycle.remainingMs,
          paused: state.cycle.paused
        };
      },

      consumeBooster: function (now) {
        advance(now || Date.now());
        if (state.boosters <= 0) return false;
        state.boosters--;
        advance(now || Date.now());
        save();
        return true;
      },

      /* Recyclage : gagne du temps sur le prochain booster.
       * L'excédent est reporté sur le cycle suivant ; si le cap de 3
       * boosters est atteint, le recyclage est bloqué (rien à accélérer). */
      recycle: function (raritySlugs, now) {
        now = now || Date.now();
        advance(now);
        if (state.boosters >= MAX_BOOSTERS) {
          return { blocked: true, gainMs: 0, granted: 0 };
        }
        var gain = 0;
        (raritySlugs || []).forEach(function (slug) {
          gain += RECYCLE_GAINS[slug] || 0;
        });
        if (gain <= 0) {
          return { blocked: false, gainMs: 0, granted: 0 };
        }

        var c = state.cycle;
        c.remainingMs -= gain;
        var granted = 0;
        while (c.remainingMs <= 0 && state.boosters < MAX_BOOSTERS) {
          state.boosters++;
          c.remainingMs += CYCLE_MS;
          granted++;
        }
        if (state.boosters >= MAX_BOOSTERS && c.remainingMs <= 0) {
          c.remainingMs = CYCLE_MS;
        }
        save();
        return { blocked: false, gainMs: gain, granted: granted };
      },

      addCards: function (cardIds) {
        (cardIds || []).forEach(function (id) {
          state.collection[id] = (state.collection[id] || 0) + 1;
        });
        save();
      },

      removeCards: function (cardIds) {
        (cardIds || []).forEach(function (id) {
          if (!state.collection[id]) return;
          state.collection[id]--;
          if (state.collection[id] <= 0) delete state.collection[id];
        });
        save();
      },

      getRemainingMs: function (now) {
        advance(now || Date.now());
        return state.cycle.remainingMs;
      },

      save: save,

      reset: function (now) {
        state = defaultState(now);
        save();
      }
    };

    load();
    return api;
  }

  function memoryBackend() {
    var data = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); }
    };
  }

  var api = { createStore: createStore, memoryBackend: memoryBackend };
  root.SFCStorage = api;

  /* Back-end navigateur, créé seulement si localStorage est disponible. */
  if (typeof localStorage !== 'undefined') {
    api.browser = (function () {
      try {
        localStorage.setItem('__sfcards_probe', '1');
        localStorage.removeItem('__sfcards_probe');
        return createStore(localStorage);
      } catch (e) {
        return createStore(memoryBackend());
      }
    })();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
