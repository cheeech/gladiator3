// Measure limb jitter while standing idle at guard.
// Reports mean angular speed of arm/leg bodies over the last 3 seconds.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld, groups, G_WORLD, G_P_BODY, G_P_WPN } from '../src/physics.js';
import { Ragdoll } from '../src/ragdoll.js';

await RAPIER.init();
const scene   = new THREE.Scene();
const physics = new PhysicsWorld(RAPIER);
physics.buildArenaStatics();

const p = new Ragdoll(scene, physics, {
  x: 0, z: 0, facing: 0,
  bodyGroups:   groups(G_P_BODY, G_WORLD),
  weaponGroups: groups(G_P_WPN,  G_WORLD),
});

const LIMBS = ['upper_arm_l','upper_arm_r','lower_arm_l','lower_arm_r',
               'upper_leg_l','upper_leg_r','lower_leg_l','lower_leg_r'];

const dt = 1 / 60;
let samples = 0, angSum = 0, linSum = 0;
const perPart = {};
const ALL = [...LIMBS, 'pelvis', 'torso', 'head'];
for (const n of ALL) perPart[n] = 0;
let swordAng = 0;

for (let i = 0; i < 360; i++) {   // 6 seconds
  p.updateControl(dt, { vx: 0, vz: 0, targetYaw: 0, aimYaw: 0.3, aimPitch: 0.25, thrust: false });
  physics.step(dt);
  if (i >= 180) {                 // measure once settled
    for (const name of ALL) {
      const w = p.bodies[name].angvel();
      const mag = Math.hypot(w.x, w.y, w.z);
      perPart[name] += mag;
      if (LIMBS.includes(name)) {
        const v = p.bodies[name].linvel();
        angSum += mag;
        linSum += Math.hypot(v.x, v.y, v.z);
        samples++;
      }
    }
    const sw = p.swordBody.angvel();
    swordAng += Math.hypot(sw.x, sw.y, sw.z);
  }
}

const frames = 180;
for (const n of ALL) console.log(`  ${n.padEnd(12)} |angvel| = ${(perPart[n]/frames).toFixed(3)} rad/s`);
console.log(`  ${'sword'.padEnd(12)} |angvel| = ${(swordAng/frames).toFixed(3)} rad/s`);

const meanAng = angSum / samples;
const meanLin = linSum / samples;
console.log(`idle limb jitter: mean |angvel| = ${meanAng.toFixed(3)} rad/s, mean |linvel| = ${meanLin.toFixed(3)} m/s`);

if (meanAng > 0.8) throw new Error('limbs vibrating: mean angular speed too high');
if (meanLin > 0.15) throw new Error('limbs vibrating: mean linear speed too high');
console.log('VIBRATION TEST PASSED');
