#!/usr/bin/env node
/* Tests des invariants du jeu : timer, recyclage, génération de booster. */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const SFCStorage = require(path.join(__dirname, '..', 'js', 'storage.js'));
const SFCBooster = require(path.join(__dirname, '..', 'js', 'booster.js'));

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ok  ' + label);
}

/* ---- Données réelles du set 1 ---- */
const payload = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'sets', 'streetfighter', 'cards.json'),
  'utf8'
));
const cards = payload.cards;
assert.strictEqual(cards.length, 143, 'cards.json doit contenir 143 cartes');

function newStore() {
  return SFCStorage.createStore(SFCStorage.memoryBackend());
}

console.log('Génération de booster');

check('10 cartes par booster, ids tous présents dans le set', () => {
  const valid = new Set(cards.map(c => c.id));
  for (let i = 0; i < 5000; i++) {
    const ids = SFCBooster.generate(cards);
    assert.strictEqual(ids.length, 10);
    ids.forEach(id => assert(valid.has(id), 'id inconnu : ' + id));
  }
});

check('au moins 1 rare ou mieux dans chaque booster', () => {
  for (let i = 0; i < 20000; i++) {
    const ids = SFCBooster.generate(cards);
    const hasRarePlus = ids.some(id => {
      const card = cards.find(c => c.id === id);
      return SFCBooster.isRarePlus(card.rarity.slug);
    });
    assert(hasRarePlus, 'booster sans rare+ : ' + ids.join(','));
  }
});

check('distribution des raretés dans les ordres de grandeur attendus', () => {
  const counts = {};
  const N = 10000;
  for (let i = 0; i < N; i++) {
    SFCBooster.generate(cards).forEach(id => {
      const card = cards.find(c => c.id === id);
      counts[card.rarity.slug] = (counts[card.rarity.slug] || 0) + 1;
    });
  }
  const total = N * 10;
  const pct = slug => (counts[slug] || 0) / total;
  console.log('       répartition :', Object.fromEntries(
    Object.entries(counts).map(([k, v]) => [k, (100 * v / total).toFixed(1) + '%'])
  ));
  assert(pct('commune') > 0.35 && pct('commune') < 0.65, 'commune hors plage');
  assert(pct('inhabituelle') > 0.15 && pct('inhabituelle') < 0.45, 'inhabituelle hors plage');
  assert(pct('rare') > 0.10 && pct('rare') < 0.45, 'rare hors plage');
  assert(pct('ultra-rare') > 0.01 && pct('ultra-rare') < 0.25, 'ultra-rare hors plage');
});

check('aucune promotionnelle/SE/secret dans le set 1 (inexistantes)', () => {
  for (let i = 0; i < 2000; i++) {
    SFCBooster.generate(cards).forEach(id => {
      const card = cards.find(c => c.id === id);
      assert(!['promotionnelle', 'se', 'secret-rare'].includes(card.rarity.slug));
    });
  }
});

console.log('Timer');

check('départ : 1 booster, 60 min', () => {
  const s = newStore();
  const snap = s.tick(Date.now());
  assert.strictEqual(snap.boosters, 1);
  assert.strictEqual(snap.remainingMs, HOUR);
  assert.strictEqual(snap.paused, false);
});

check('un booster toutes les heures', () => {
  const t0 = Date.now();
  const s = newStore();
  assert.strictEqual(s.tick(t0).boosters, 1);
  assert.strictEqual(s.tick(t0 + HOUR).boosters, 2);
  assert.strictEqual(s.tick(t0 + 2 * HOUR).boosters, 3);
});

check('cap à 3 : figé, même après 10 h d\'absence', () => {
  const t0 = Date.now();
  const s = newStore();
  const snap = s.tick(t0 + 10 * HOUR);
  assert.strictEqual(snap.boosters, 3);
  assert.strictEqual(snap.paused, true);
  assert(snap.remainingMs > 0, 'temps résiduel négatif au cap : ' + snap.remainingMs);
  assert.strictEqual(snap.remainingMs, HOUR, 'remis à 60 min (pas de dette)');
  const later = s.tick(t0 + 20 * HOUR);
  assert.strictEqual(later.boosters, 3);
  assert.strictEqual(later.remainingMs, HOUR, 'timer bien figé');
});

check('absence de 4 h avec 0 boosters -> exactement 3', () => {
  const t0 = Date.now();
  const s = newStore();
  s.consumeBooster(t0); // 0 booster, 60 min
  const snap = s.tick(t0 + 4 * HOUR);
  assert.strictEqual(snap.boosters, 3);
});

check('ouverture après le figeage reprend le temps restant', () => {
  const t0 = Date.now();
  const s = newStore();
  s.tick(t0 + 10 * HOUR); // cap atteint, figé à 60 min
  assert.strictEqual(s.consumeBooster(t0 + 10 * HOUR), true);
  const snap = s.tick(t0 + 10 * HOUR + 1000);
  assert.strictEqual(snap.boosters, 2);
  assert(snap.remainingMs > HOUR - 5000, 'a bien repris ~60 min : ' + snap.remainingMs);
  assert.strictEqual(snap.paused, false);
});

check('pas de booster tant que le temps n\'est pas écoulé', () => {
  const t0 = Date.now();
  const s = newStore();
  assert.strictEqual(s.consumeBooster(t0), true);
  assert.strictEqual(s.tick(t0 + HOUR - 1).boosters, 0);
  assert.strictEqual(s.tick(t0 + HOUR).boosters, 1);
  assert.strictEqual(s.consumeBooster(t0 + HOUR), true, 'booster disponible');
  assert.strictEqual(s.consumeBooster(t0 + HOUR), false, 'plus de booster');
});

console.log('Recyclage');

check('gains par rareté', () => {
  const s = newStore();
  assert.strictEqual(SFCStorage.createStore(SFCStorage.memoryBackend())
    .RECYCLE_GAINS.commune, 1 * MIN);
  assert.strictEqual(s.RECYCLE_GAINS.inhabituelle, 3 * MIN);
  assert.strictEqual(s.RECYCLE_GAINS.rare, 10 * MIN);
  assert.strictEqual(s.RECYCLE_GAINS['ultra-rare'], 30 * MIN);
  assert.strictEqual(s.RECYCLE_GAINS['secret-rare'], 30 * MIN);
});

check('recyclage simple : temps restant diminué', () => {
  const t0 = Date.now();
  const s = newStore();
  s.consumeBooster(t0); // 0 booster, 60 min
  const r = s.recycle(['commune'], t0 + 10 * MIN);
  assert.strictEqual(r.gainMs, 1 * MIN);
  assert.strictEqual(r.granted, 0);
  // 60 min de départ - 10 min écoulées - 1 min recyclée
  assert.strictEqual(s.tick(t0 + 10 * MIN).remainingMs, HOUR - 10 * MIN - 1 * MIN);
});

check('report de l\'excédent sur le cycle suivant', () => {
  const t0 = Date.now();
  const s = newStore();
  s.consumeBooster(t0); // 0 booster, 60 min
  s.tick(t0 + 55 * MIN); // reste 5 min
  const r = s.recycle(['rare'], t0 + 55 * MIN); // +10 min -> -5 min
  assert.strictEqual(r.granted, 1, 'booster accordé immédiatement');
  const snap = s.tick(t0 + 55 * MIN);
  assert.strictEqual(snap.boosters, 1);
  assert.strictEqual(snap.remainingMs, HOUR - 5 * MIN, 'excédent de 5 min reporté');
});

check('report sur plusieurs cycles (gain très long)', () => {
  const t0 = Date.now();
  const s = newStore();
  s.consumeBooster(t0);
  s.tick(t0 + 59 * MIN); // reste 1 min
  const r = s.recycle(['ultra-rare', 'ultra-rare', 'ultra-rare'], t0 + 59 * MIN);
  assert.strictEqual(r.gainMs, 90 * MIN);
  assert.strictEqual(r.granted, 2, '1 min -> boost, puis 30+59 reportés');
  const snap = s.tick(t0 + 59 * MIN);
  assert.strictEqual(snap.boosters, 2);
  assert.strictEqual(snap.remainingMs, HOUR - 29 * MIN, '60 - (90-1) - 60 = 29 min manquantes');
});

check('recyclage bloqué au cap de 3 boosters', () => {
  const t0 = Date.now();
  const s = newStore();
  s.tick(t0 + 2 * HOUR); // 3 boosters
  const r = s.recycle(['ultra-rare'], t0 + 2 * HOUR);
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(r.gainMs, 0);
  assert.strictEqual(s.tick(t0 + 2 * HOUR).boosters, 3);
});

check('pas de temps perdu si le recyclage dépasse le cap', () => {
  const t0 = Date.now();
  const s = newStore();
  s.tick(t0 + HOUR); // 2 boosters (initial + 1 accordé)
  // on rouvre un booster pour repasser sous le cap puis on recycle énormément
  s.consumeBooster(t0 + HOUR);
  const r = s.recycle(['ultra-rare', 'ultra-rare', 'ultra-rare', 'ultra-rare'],
    t0 + HOUR);
  assert.strictEqual(r.granted, 2, 'report puis cap atteint à 3');
  const snap = s.tick(t0 + HOUR);
  assert.strictEqual(snap.boosters, 3);
  assert(snap.remainingMs > 0, 'résiduel positif après cap : ' + snap.remainingMs);
});

console.log('Collection');

check('ajout / suppression d\'exemplaires', () => {
  const s = newStore();
  s.addCards(['streetfighter-001', 'streetfighter-001', 'streetfighter-002']);
  assert.strictEqual(s.getState().collection['streetfighter-001'], 2);
  assert.strictEqual(s.getState().collection['streetfighter-002'], 1);
  s.removeCards(['streetfighter-001', 'streetfighter-001', 'streetfighter-002']);
  assert.strictEqual(s.getState().collection['streetfighter-001'], undefined);
  assert.strictEqual(s.getState().collection['streetfighter-002'], undefined);
});

check('persistance : état sauvegardé et rechargé', () => {
  const backend = SFCStorage.memoryBackend();
  const t0 = Date.now();
  const s1 = SFCStorage.createStore(backend);
  s1.consumeBooster(t0);
  s1.addCards(['streetfighter-003']);
  const s2 = SFCStorage.createStore(backend); // « rechargement »
  assert.strictEqual(s2.getState().boosters, 0);
  assert.strictEqual(s2.getState().collection['streetfighter-003'], 1);
  assert.strictEqual(s2.tick(t0 + HOUR).boosters, 1, 'timer reparti depuis le bon point');
});

check('état corrompu -> réinitialisation propre', () => {
  const backend = {
    getItem: () => '{pas du json',
    setItem: () => {}
  };
  const s = SFCStorage.createStore(backend);
  assert.strictEqual(s.getState().boosters, 1);
  assert.strictEqual(s.getState().version, 1);
});

console.log('\n' + passed + ' tests OK');
