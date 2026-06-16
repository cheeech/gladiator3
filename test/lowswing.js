// Headless test: a low sweep drives the blade tip down near the ground, low
// enough to strike a downed/crawling foe (torso ~0.15 m). Compares against a
// normal horizontal cut, which stays up around chest height.
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

const dt = 1 / 60;
const _q = new THREE.Quaternion();

// World-space height of the blade tip (sword local +Z * length beyond COM).
function bladeTipY() {
  const r = p.swordBody.rotation();
  const t = p.swordBody.translation();
  _q.set(r.x, r.y, r.z, r.w);
  const tip = new THREE.Vector3(0, 0, 0.40).applyQuaternion(_q);
  return t.y + tip.y;
}

// Drive one swing: hold the windup aim for `wind` frames, then the strike aim,
// and report the lowest the blade tip reaches during the strike.
function swing(windup, strike, base) {
  // settle to a stand first
  for (let i = 0; i < 120; i++) {
    p.updateControl(dt, { vx: 0, vz: 0, targetYaw: 0, aimYaw: 0.3, aimPitch: 0.25, thrust: false, reach: 0.52 });
    physics.step(dt, () => {});
  }
  for (let i = 0; i < 25; i++) {
    p.updateControl(dt, { vx: 0, vz: 0, targetYaw: 0, aimYaw: windup.yaw, aimPitch: base + windup.pitch, thrust: false, reach: windup.reach ?? 0.52 });
    physics.step(dt, () => {});
  }
  let lowest = 99;
  for (let i = 0; i < 25; i++) {
    p.updateControl(dt, { vx: 0, vz: 0, targetYaw: 0, aimYaw: strike.yaw, aimPitch: base + strike.pitch, thrust: !!strike.thrust, reach: strike.reach ?? 0.62 });
    physics.step(dt, () => {});
    lowest = Math.min(lowest, bladeTipY());
  }
  return lowest;
}

const base = -0.43;  // looking down at a grounded foe

const lowSweep = swing(
  { yaw:  1.4, pitch: -0.20, reach: 0.50 },
  { yaw: -1.2, pitch: -0.85, reach: 0.85 },
  base,
);
const normalCut = swing(
  { yaw:  1.5, pitch:  0.55 },
  { yaw: -1.3, pitch: -0.10 },
  base,
);

console.log('low sweep   blade tip lowest:', lowSweep.toFixed(2), 'm');
console.log('normal cut  blade tip lowest:', normalCut.toFixed(2), 'm');

const reachesGround = lowSweep < 0.45;        // can reach a downed torso/head
const lowerThanCut  = lowSweep < normalCut - 0.15;
const ok = reachesGround && lowerThanCut;
console.log(ok ? 'LOW SWING TEST PASSED' : 'LOW SWING TEST FAILED');
process.exit(ok ? 0 : 1);
