// Verify the neutral windup arcs the blade tip upward (pendulum backswing)
// and the release produces a fast forward stab.
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

const dt = 1 / 60;
const aim = { yaw: 0.3, pitch: 0.25 };
let reach;

function tipPos() {
  const t = p.swordBody.translation();
  const r = p.swordBody.rotation();
  const off = new THREE.Vector3(0, 0, 0.40)
    .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
  return new THREE.Vector3(t.x + off.x, t.y + off.y, t.z + off.z);
}

const cmd = () => ({ vx: 0, vz: 0, targetYaw: 0, aimYaw: aim.yaw, aimPitch: aim.pitch, thrust: false, reach });

// 1.5s settle at guard
for (let i = 0; i < 90; i++) { p.updateControl(dt, cmd()); physics.step(dt); }
const guardTip = tipPos();

// 0.7s windup (pendulum backswing, hand raised overhead)
let maxTipY = -Infinity, minTipZ = Infinity, maxGripY = -Infinity;
function gripPos() {
  const t = p.swordBody.translation();
  const r = p.swordBody.rotation();
  const off = new THREE.Vector3(0, 0, -0.40)
    .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
  return new THREE.Vector3(t.x + off.x, t.y + off.y, t.z + off.z);
}
for (let i = 0; i < 42; i++) {
  const k = Math.min(1, dt * 10);
  aim.yaw += (0.05 - aim.yaw) * k;
  aim.pitch += (0.25 + 1.85 - aim.pitch) * k;
  reach = (reach ?? 0.52) + (0.50 - (reach ?? 0.52)) * k;
  p.updateControl(dt, cmd()); physics.step(dt);
  const t = tipPos();
  maxTipY = Math.max(maxTipY, t.y);
  minTipZ = Math.min(minTipZ, t.z);
  maxGripY = Math.max(maxGripY, gripPos().y);
}
const windupTip  = tipPos();
const windupGrip = gripPos();
const windupBladeY = (() => {
  const r = p.swordBody.rotation();
  return new THREE.Vector3(0, 0, 1)
    .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).y;
})();

// 0.4s release (overhead chop down toward the ground)
let maxFwdSpeed = 0, maxStabZ = -Infinity, minStabY = Infinity;
for (let i = 0; i < 24; i++) {
  const k = Math.min(1, dt * 22);
  aim.yaw += (0 - aim.yaw) * k;
  aim.pitch += (0.25 - 0.85 - aim.pitch) * k;
  reach += (0.85 - reach) * k;
  p.updateControl(dt, cmd()); physics.step(dt);
  maxFwdSpeed = Math.max(maxFwdSpeed, p.swordStrikeVelocity().length());
  const t = tipPos();
  maxStabZ = Math.max(maxStabZ, t.z);
  minStabY = Math.min(minStabY, t.y);
}
const stabTip = tipPos();

console.log(`guard  tip: y=${guardTip.y.toFixed(2)} z=${guardTip.z.toFixed(2)}`);
console.log(`windup tip: y=${windupTip.y.toFixed(2)} z=${windupTip.z.toFixed(2)} (peak y=${maxTipY.toFixed(2)}, bladeDir.y=${windupBladeY.toFixed(2)})`);
console.log(`windup grip: y=${windupGrip.y.toFixed(2)} (peak y=${maxGripY.toFixed(2)}) — head top ~1.84`);
console.log(`strike tip: fwd peak z=${maxStabZ.toFixed(2)}, low point y=${minStabY.toFixed(2)}, max blade speed ${maxFwdSpeed.toFixed(1)} m/s`);

if (windupGrip.y < 1.80) throw new Error('hand not raised above head during backswing');
if (windupBladeY < 0.3) throw new Error('blade not raised during backswing (pendulum broken)');
if (windupTip.z > guardTip.z - 0.5) throw new Error('sword did not draw backwards');
if (maxStabZ < windupTip.z + 0.4) throw new Error('release did not drive the blade forward');
if (minStabY > 0.9) throw new Error('swing arc does not come down toward the ground');
if (maxFwdSpeed < 4) throw new Error('stab too slow');
console.log('PENDULUM TEST PASSED');
