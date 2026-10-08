/* Génération du contenu d'un booster (10 cartes, au moins 1 rare ou mieux). */
(function (root) {
  'use strict';

  /* Tiers des raretés supérieures à l'ultra-rare (futurs sets). */
  var PROMO_TIERS = ['promotionnelle', 'se', 'secret-rare'];

  /* Slot garanti : au moins une carte de rareté rare ou mieux. */
  var GUARANTEED_WEIGHTS = [
    ['rare', 0.65],
    ['ultra-rare', 0.25],
    [PROMO_TIERS, 0.10]
  ];

  /* 9 slots standards. */
  var NORMAL_WEIGHTS = [
    ['commune', 0.55],
    ['inhabituelle', 0.30],
    ['rare', 0.12],
    ['ultra-rare', 0.03]
  ];

  var RANKS = [
    'commune', 'inhabituelle', 'rare', 'ultra-rare',
    'promotionnelle', 'se', 'secret-rare'
  ];

  function isRarePlus(slug) {
    return RANKS.indexOf(slug) >= RANKS.indexOf('rare');
  }

  function weightedPick(weights, rng) {
    var r = rng();
    var acc = 0;
    var last = null;
    for (var i = 0; i < weights.length; i++) {
      last = weights[i][0];
      acc += weights[i][1];
      if (r < acc) return weights[i][0];
    }
    return last;
  }

  function groupByRarity(cards) {
    var map = {};
    cards.forEach(function (card) {
      var slug = card.rarity && card.rarity.slug;
      if (!slug) return;
      (map[slug] = map[slug] || []).push(card);
    });
    return map;
  }

  function choice(arr, rng) {
    return arr[Math.floor(rng() * arr.length) % arr.length];
  }

  /* Construit la liste des raretés à essayer, du tirage initial vers les
   * raretés les plus proches. `minRank` (slot garanti) force le repli à
   * rester sur des raretés au moins aussi élevées tant qu'il en existe. */
  function fallbackChain(initial, minRank) {
    var wanted = Array.isArray(initial) ? initial.slice() : [initial];
    var rank = RANKS.indexOf(wanted[0]);
    var chain = wanted.slice();
    var rest = RANKS.filter(function (slug) { return chain.indexOf(slug) === -1; });

    if (minRank !== undefined) {
      rest
        .filter(function (slug) { return RANKS.indexOf(slug) >= minRank; })
        .sort(function (a, b) { return RANKS.indexOf(b) - RANKS.indexOf(a); })
        .forEach(function (slug) { chain.push(slug); });
    }

    rest
      .slice()
      .sort(function (a, b) {
        var da = Math.abs(RANKS.indexOf(a) - rank);
        var db = Math.abs(RANKS.indexOf(b) - rank);
        if (da !== db) return da - db;
        return RANKS.indexOf(b) - RANKS.indexOf(a);
      })
      .forEach(function (slug) {
        if (chain.indexOf(slug) === -1) chain.push(slug);
      });

    return chain;
  }

  function pickCard(pool, initial, rng, minRank) {
    var chain = fallbackChain(initial, minRank);
    for (var i = 0; i < chain.length; i++) {
      var bucket = pool[chain[i]];
      if (bucket && bucket.length) return choice(bucket, rng);
    }
    return null;
  }

  /* Retourne un tableau de 10 ids de cartes. */
  function generate(cards, rng) {
    rng = rng || Math.random;
    var pool = groupByRarity(cards);
    var ids = [];

    var guaranteed = pickCard(
      pool, weightedPick(GUARANTEED_WEIGHTS, rng), rng, RANKS.indexOf('rare')
    );
    if (!guaranteed) throw new Error('Aucune carte disponible pour le booster');
    ids.push(guaranteed.id);

    for (var i = 0; i < 9; i++) {
      var picked = pickCard(pool, weightedPick(NORMAL_WEIGHTS, rng), rng);
      ids.push(picked.id);
    }
    return ids;
  }

  var api = {
    generate: generate,
    isRarePlus: isRarePlus,
    GUARANTEED_WEIGHTS: GUARANTEED_WEIGHTS,
    NORMAL_WEIGHTS: NORMAL_WEIGHTS
  };

  root.SFCBooster = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
