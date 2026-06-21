// Headless test: severing a leg drops the fighter to the ground and lets him
// crawl (slowly) while staying alive and hittable.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld, groups,
         G_WORLD, G_P_BODY, G_P_WPN, G_E_BODY, G_E_WPN } from '../src/physics.js';
import { Ragdoll } from '../src/ragdoll.js';

await RAPIER.init();
const scene   = new THREE.Scene();
const physics = new PhysicsWorld(RAPIER);
physics.buildArenaStatics();

const p = new Ragdoll(scene, physics, {
  x: 0, z: 0, facing: 0,
  bodyGroups:   groups(G_P_BODY, G_WORLD | G_E_BODY | G_E_WPN),
  weaponGroups: groups(G_P_WPN,  G_WORLD | G_E_BODY | G_E_WPN),
});

const dt  = 1 / 60;
const cmd = () => ({ vx: 2.0, vz: 0, targetYaw: 0, aimYaw: 0.3, aimPitch: 0.25, thrust: false, reach: 0.52 });

// Stand for 2 s.
for (let i = 0; i < 120; i++) { p.updateControl(dt, cmd()); physics.step(dt, () => {}); }
console.log('standing pelvis h:', p.pelvisPos().y.toFixed(2), 'downed:', p.downed, 'alive:', p.alive);

// Sever a leg (enough overkill to dismember), leaving vital HP intact.
const need = Math.max(35 * 2.5, 75);
const r1   = p.applyDamage('upper_leg_r', need + 5);
console.log('after leg damage -> severed:', r1.severed, 'downed:', p.downed, 'alive:', p.alive);

// Let him settle to the ground for 1 s after losing the leg.
for (let i = 0; i < 60; i++) { p.updateControl(dt, cmd()); physics.step(dt, () => {}); }

// Now crawl forward for 3 s; measure steady-state height + travel.
const x0 = p.pelvisPos().x;
let maxH = -99;
for (let i = 0; i < 180; i++) {
  p.updateControl(dt, cmd());
  physics.step(dt, () => {});
  maxH = Math.max(maxH, p.pelvisPos().y);
}
const x1 = p.pelvisPos().x;
console.log('steady crawl pelvis h (max):', maxH.toFixed(2), 'final:', p.pelvisPos().y.toFixed(2));
console.log('crawled dx:', (x1 - x0).toFixed(2), 'alive:', p.alive, 'hpFrac:', p.totalHpFraction().toFixed(2));

// Still takes damage while down.
const hpBefore = p.totalHpFraction();
p.applyDamage('torso', 20);
const tookDamage = p.totalHpFraction() < hpBefore;

const stayedDown = maxH < 0.7;          // never springs back to standing height
// The fighter now carries a shield: the dropped shield-arm drags against the
// prone body, so a one-legged crawl is slower than it was bare-handed. We still
// require clear forward progress — just not as much.
const crawled    = Math.abs(x1 - x0) > 0.05;
const ok = r1.severed && stayedDown && crawled && p.alive && tookDamage;
console.log('hittable while down:', tookDamage);
console.log(ok ? 'CRAWL TEST PASSED' : 'CRAWL TEST FAILED');
process.exit(ok ? 0 : 1);
