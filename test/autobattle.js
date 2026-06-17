// Headless test for the auto-battle: two AI-driven fighters attack each other,
// exercise the full set of swing styles, deal damage, and reach a winner.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld, groups,
         G_WORLD, G_P_BODY, G_P_WPN, G_E_BODY, G_E_WPN } from '../src/physics.js';
import { Ragdoll } from '../src/ragdoll.js';
import { EnemyAI } from '../src/ai.js';

await RAPIER.init();
const scene   = new THREE.Scene();
const physics = new PhysicsWorld(RAPIER);
physics.buildArenaStatics();

const gold = new Ragdoll(scene, physics, {
  x: -2, z: 0, facing:  Math.PI / 2,
  bodyGroups:   groups(G_P_BODY, G_WORLD | G_E_BODY | G_E_WPN),
  weaponGroups: groups(G_P_WPN,  G_WORLD | G_E_BODY | G_E_WPN),
});
const red = new Ragdoll(scene, physics, {
  x:  2, z: 0, facing: -Math.PI / 2,
  bodyGroups:   groups(G_E_BODY, G_WORLD | G_P_BODY | G_P_WPN),
  weaponGroups: groups(G_E_WPN,  G_WORLD | G_P_BODY | G_P_WPN),
});

// Two aggressive AIs — exactly what auto-battle wires up.
const redAI  = new EnemyAI(red,  gold, { sparring: false });
const goldAI = new EnemyAI(gold, red,  { sparring: false });

// "Full set of attacks": the AI must draw from all six styles. Sampling the
// selector directly is independent of how quickly a given fight ends.
const fullSet = ['cut_l', 'cut_r', 'low_l', 'low_r', 'overhead', 'thrust'];
const sampled = new Set();
for (let i = 0; i < 400; i++) sampled.add(goldAI._pickStyle().name);
const usedFull = fullSet.every(s => sampled.has(s));
console.log('attack styles available to AI:', [...sampled].sort().join(', '));

const dt = 1 / 60;
let weaponClashes = 0;
let startHpGold = gold.totalHpFraction(), startHpRed = red.totalHpFraction();

// Mirror Game._onContact: weapon↔weapon deflects (stagger), weapon↔part damages.
function onContact(m1, m2) {
  if (m1.kind === 'weapon' && m2.kind === 'weapon') {
    weaponClashes++;
    m1.ref.staggerSword(0.18);
    m2.ref.staggerSword(0.18);
    return;
  }
  let atk = null, vic = null, part = null;
  if (m1.kind === 'weapon' && m2.kind === 'part' && m1.ref !== m2.ref) {
    atk = m1.ref; vic = m2.ref; part = m2.part;
  } else if (m2.kind === 'weapon' && m1.kind === 'part' && m2.ref !== m1.ref) {
    atk = m2.ref; vic = m1.ref; part = m1.part;
  }
  if (!atk) return;
  if (hitCd.get(atk) > 0) return;          // per-attacker cooldown, as in game.js
  const speed = atk.swordStrikeVelocity().length();
  if (speed > 1.6) { vic.applyDamage(part, Ragdoll.impactDamage(speed)); hitCd.set(atk, 0.22); }
}

const hitCd = new Map([[gold, 0], [red, 0]]);
let frames = 0;
for (let i = 0; i < 60 * 150; i++) {   // up to 150 s (fighters evade a lot now)
  for (const f of [gold, red]) hitCd.set(f, Math.max(0, hitCd.get(f) - dt));
  gold.updateControl(dt, goldAI.update(dt));
  red.updateControl(dt, redAI.update(dt));
  physics.step(dt, onContact);
  frames = i + 1;
  if (!gold.alive || !red.alive) break;
}
console.log('fight lasted:', (frames * dt).toFixed(1), 's');

const dmgDealt = (gold.totalHpFraction() < startHpGold) || (red.totalHpFraction() < startHpRed);
const winner   = !gold.alive || !red.alive;
console.log('weapon clashes:', weaponClashes);
console.log('gold hp:', gold.totalHpFraction().toFixed(2), 'red hp:', red.totalHpFraction().toFixed(2),
            'alive:', gold.alive, '/', red.alive);

const ok = usedFull && dmgDealt && winner;
console.log('used full attack set:', usedFull, ' damage dealt:', dmgDealt, ' winner decided:', winner);
console.log(ok ? 'AUTO-BATTLE TEST PASSED' : 'AUTO-BATTLE TEST FAILED');
process.exit(ok ? 0 : 1);
