// Headless test for stamina: holding the heavy blade raised drains stamina,
// exhaustion forces the blade to droop downward, and resting recovers it.
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
  x: 0, z: 0, facing: Math.PI / 2,
  bodyGroups:   groups(G_P_BODY, G_WORLD | G_E_BODY | G_E_WPN),
  weaponGroups: groups(G_P_WPN,  G_WORLD | G_E_BODY | G_E_WPN),
});

const dt  = 1 / 60;
const q   = new THREE.Quaternion();
const up  = { vx: 0, vz: 0, targetYaw: Math.PI / 2, aimYaw: 0, aimPitch: 0.6,  thrust: false, reach: 0.52 };
const rest= { vx: 0, vz: 0, targetYaw: Math.PI / 2, aimYaw: 0, aimPitch: -0.7, thrust: false, reach: 0.52 };

function bladePitch() {
  const r = p.swordBody.rotation();
  q.set(r.x, r.y, r.z, r.w);
  return Math.asin(Math.max(-1, Math.min(1, new THREE.Vector3(0, 0, 1).applyQuaternion(q).y)));
}

// Settle holding the blade up.
for (let i = 0; i < 120; i++) { p.updateControl(dt, up); physics.step(dt, () => {}); }
const startStam = p.stamina;
console.log('stamina after raising blade:', startStam.toFixed(0));

// Hold up until exhausted (max 25 s).
let frames = 0, exhaustedAt = -1;
for (let i = 0; i < 60 * 25; i++) {
  p.updateControl(dt, up);
  physics.step(dt, () => {});
  frames++;
  if (p.exhausted) { exhaustedAt = frames; break; }
}
console.log('exhausted after holding for:', exhaustedAt > 0 ? (exhaustedAt * dt).toFixed(1) + ' s' : 'NEVER',
            ' stamina:', p.stamina.toFixed(0));

// While exhausted and STILL commanding the blade up, it must droop downward.
let drooped = false;
for (let i = 0; i < 50; i++) {
  p.updateControl(dt, up);
  physics.step(dt, () => {});
  if (p.exhausted && bladePitch() < -0.2) drooped = true;
}
console.log('blade pitch while exhausted (commanding up):', bladePitch().toFixed(2), 'rad  drooped:', drooped);

// Rest with the blade lowered — stamina should recover and exhaustion clear.
for (let i = 0; i < 60 * 8; i++) { p.updateControl(dt, rest); physics.step(dt, () => {}); }
console.log('stamina after resting:', p.stamina.toFixed(0), ' exhausted:', p.exhausted);

const drained   = exhaustedAt > 0 && startStam > 50;
const recovered = !p.exhausted && p.stamina > 35;   // climbed back past STAM_RECOVER_AT
const ok = drained && drooped && recovered;
console.log(ok ? 'STAMINA TEST PASSED' : 'STAMINA TEST FAILED');
process.exit(ok ? 0 : 1);
