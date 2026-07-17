// Headless test: the limb IK holds a human stance and walk.
//  1. Standing idle: legs are IK-posed (not dangling) — feet planted near the
//     ground directly under the hips, knees bent slightly FORWARD, toes facing
//     body-forward (no free twist about the bone).
//  2. Arms: hand mesh sits on the sword grip / shield strap, elbows bend
//     below the shoulder and outward — never up or across the chest.
//  3. Walking: stance feet stay pinned (no skating), toes keep facing forward.
//  4. Backpedalling: knees still bend body-forward, never backward.
//  5. Death: the stance blend fades out so the limbs hand back to ragdoll.
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
  x: 0, z: 0, facing: 0,   // facing +Z
  bodyGroups:   groups(G_P_BODY, G_WORLD | G_E_BODY | G_E_WPN),
  weaponGroups: groups(G_P_WPN,  G_WORLD | G_E_BODY | G_E_WPN),
});

const dt  = 1 / 60;
const cmd = (vx, vz) => ({ vx, vz, targetYaw: 0, aimYaw: 0.3, aimPitch: 0.25, thrust: false, reach: 0.52 });
const step = c => { p.updateControl(dt, c); physics.step(dt, () => {}); p.syncMeshes(); };

// World position of a leg mesh's bottom end (the IK "foot" / "knee" point).
function segBottom(name) {
  const m   = p.meshes[name];
  const geo = m.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  return new THREE.Vector3(0, geo.boundingBox.min.y, 0)
    .applyQuaternion(m.quaternion).add(m.position);
}
// World position of a hip joint (pelvis centre + rotated local offset).
function hipWorld(sign) {
  const t = p.bodies.pelvis.translation();
  const r = p.bodies.pelvis.rotation();
  return new THREE.Vector3(sign * 0.10, -0.16, 0)
    .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))
    .add(new THREE.Vector3(t.x, t.y, t.z));
}

// ── 1. Idle stance ──────────────────────────────────────────────────────────
for (let i = 0; i < 150; i++) step(cmd(0, 0));
const fL = segBottom('lower_leg_l'), fR = segBottom('lower_leg_r');
const kL = segBottom('upper_leg_l'), kR = segBottom('upper_leg_r');
const hL = hipWorld(1),              hR = hipWorld(-1);

const idleBlend = p.standAmt > 0.85;
const feetLow   = fL.y < 0.18 && fR.y < 0.18;
const feetUnder = Math.hypot(fL.x - hL.x, fL.z - hL.z) < 0.15 &&
                  Math.hypot(fR.x - hR.x, fR.z - hR.z) < 0.15;
// Knee forward of the hip–ankle line (body faces +Z).
const kneesFwdIdle = kL.z > (hL.z + fL.z) / 2 + 0.005 &&
                     kR.z > (hR.z + fR.z) / 2 + 0.005;
// Toes (mesh local +Z) face body-forward — the bone must not be twisted.
const localZ = name => new THREE.Vector3(0, 0, 1).applyQuaternion(p.meshes[name].quaternion);
const toesFwdIdle = localZ('lower_leg_l').z > 0.5 && localZ('lower_leg_r').z > 0.5;
console.log('idle: standAmt', p.standAmt.toFixed(2),
            'footY L/R', fL.y.toFixed(3), fR.y.toFixed(3),
            'under-hip', feetUnder, 'knees fwd', kneesFwdIdle, 'toes fwd', toesFwdIdle);

// ── 1b. Arms: hands on their props, elbows down-and-out ────────────────────
function propPoint(body, local) {
  const r = body.rotation(), t = body.translation();
  return new THREE.Vector3(local.x, local.y, local.z)
    .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))
    .add(new THREE.Vector3(t.x, t.y, t.z));
}
function shoulderWorld(sign) {   // +1 left, -1 right
  const t = p.bodies.torso.translation(), r = p.bodies.torso.rotation();
  return new THREE.Vector3(sign * 0.30, 0.14, 0)
    .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))
    .add(new THREE.Vector3(t.x, t.y, t.z));
}
const grip  = propPoint(p.swordBody,  { x: 0, y: 0, z: -0.40 });
const strap = propPoint(p.shieldBody, { x: 0, y: 0, z: -0.045 });
const handR = segBottom('lower_arm_r'), handL = segBottom('lower_arm_l');
const elbR  = segBottom('upper_arm_r'), elbL  = segBottom('upper_arm_l');
const shR   = shoulderWorld(-1),        shL   = shoulderWorld(1);
const tt    = p.bodies.torso.translation();

const handsOnProps = handR.distanceTo(grip) < 0.12 && handL.distanceTo(strap) < 0.12;
const elbowsDown   = elbR.y < shR.y + 0.05 && elbL.y < shL.y + 0.05;
// Elbow on its own side of the body (outward), never crossed to the other.
const elbowsOut    = (elbR.x - shR.x) * Math.sign(shR.x - tt.x) > -0.05 &&
                     (elbL.x - shL.x) * Math.sign(shL.x - tt.x) > -0.05;
console.log('arms: hand→grip', handR.distanceTo(grip).toFixed(3),
            'hand→strap', handL.distanceTo(strap).toFixed(3),
            'elbows down', elbowsDown, 'out', elbowsOut);

// ── 2. Walk forward — stance feet must not skate, toes stay forward ─────────
let maxSlip = 0, walked = 0, minToe = 1;
const prev = { l: null, r: null };
for (let i = 0; i < 240; i++) {
  step(cmd(0, 1.6));
  if (i < 60) continue;                       // let the gait blend in
  walked = Math.max(walked, p.walkAmt);
  minToe = Math.min(minToe, localZ('lower_leg_l').z, localZ('lower_leg_r').z);
  for (const [key, leg, shin] of [['l', p.gait.l, 'lower_leg_l'], ['r', p.gait.r, 'lower_leg_r']]) {
    if (!leg.swinging) {
      const b = segBottom(shin);
      if (prev[key]) maxSlip = Math.max(maxSlip, Math.hypot(b.x - prev[key].x, b.z - prev[key].z));
      prev[key] = b;
    } else prev[key] = null;                  // swing frames don't count
  }
}
console.log('walk: walkAmt', walked.toFixed(2), 'max stance slip/frame', maxSlip.toFixed(4),
            'min toe fwd', minToe.toFixed(2));

// ── 3. Backpedal — knees still bend body-forward ────────────────────────────
let kneesFwdBack = true;
for (let i = 0; i < 180; i++) {
  step(cmd(0, -1.6));
  if (i < 60) continue;
  const k = segBottom('upper_leg_l'), h = hipWorld(1), f = segBottom('lower_leg_l');
  if (k.z < (h.z + f.z) / 2 - 0.01) kneesFwdBack = false;
}
console.log('backpedal: knees stayed forward', kneesFwdBack);

// ── 4b. Fast swings — the elbow must sweep round, not flip sides ────────────
let maxElbowJump = 0, maxWristJump = 0, maxShoulderGap = 0, prevElb = null, prevWr = null;
for (let i = 0; i < 300; i++) {
  const phase = ((i / 60) * 1.8) % 1;               // ~0.55 s windup→strike loop
  const aimYaw   = phase < 0.5 ? 1.5 - phase * 5.6 : -1.3 + (phase - 0.5) * 5.6;
  const aimPitch = phase < 0.5 ? 1.2 - phase * 4.0 : -0.8 + (phase - 0.5) * 4.0;
  step({ vx: 0, vz: 0, targetYaw: 0, aimYaw, aimPitch, thrust: false,
         reach: phase < 0.5 ? 0.45 : 0.8 });
  if (i < 30) continue;
  const eb = segBottom('upper_arm_r');
  const wr = segBottom('lower_arm_r');
  if (prevElb) maxElbowJump = Math.max(maxElbowJump, eb.distanceTo(prevElb));
  if (prevWr)  maxWristJump = Math.max(maxWristJump, wr.distanceTo(prevWr));
  prevElb = eb; prevWr = wr;
  // The arm's top pivot must stay on the shoulder joint (± a little shrug).
  const armTop = new THREE.Vector3(0, 0.14, 0)
    .applyQuaternion(p.meshes.upper_arm_r.quaternion)
    .add(p.meshes.upper_arm_r.position);
  maxShoulderGap = Math.max(maxShoulderGap, armTop.distanceTo(shoulderWorld(-1)));
}
console.log('swing: max jump/frame elbow', maxElbowJump.toFixed(3),
            'wrist', maxWristJump.toFixed(3),
            'max shoulder gap', maxShoulderGap.toFixed(3));

// ── 5. Death fades the blend out ────────────────────────────────────────────
p._die();
for (let i = 0; i < 90; i++) step(cmd(0, 0));
const fadedOut = p.standAmt < 0.05;
console.log('dead: standAmt', p.standAmt.toFixed(3));

const ok = idleBlend && feetLow && feetUnder && kneesFwdIdle && toesFwdIdle &&
           handsOnProps && elbowsDown && elbowsOut &&
           walked > 0.7 && maxSlip < 0.012 && minToe > 0.3 &&
           kneesFwdBack && maxElbowJump < maxWristJump * 1.2 + 0.02 &&
           maxShoulderGap < 0.07 && fadedOut;
console.log(ok ? 'GAIT TEST PASSED' : 'GAIT TEST FAILED');
process.exit(ok ? 0 : 1);
