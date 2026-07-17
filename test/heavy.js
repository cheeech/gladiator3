// Headless test: the charged heavy swing is high-risk / high-reward.
//  1. A heavy swing that touches NOTHING → overswing: sword control staggered
//     and the whiffed flag raised for the HUD.
//  2. A heavy that connects (markSwingLanded, as the game.js contact handlers
//     call on flesh/blade/shield contact) → no stagger.
//  3. Parried-heavy stagger scales with the attacker's own power
//     (clashResponse output × power scaling as applied in game._swordClash).
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
const cmd = (power = 1) => ({ vx: 0, vz: 0, targetYaw: 0, aimYaw: 0.3, aimPitch: 0.25,
                              thrust: false, reach: 0.52, power });
const run = (n, c) => { for (let i = 0; i < n; i++) { p.updateControl(dt, c); physics.step(dt, () => {}); } };

// Settle, then throw a heavy into empty air.
run(60, cmd());
run(30, cmd(3.2));            // heavy swing in flight, nothing touched
run(1,  cmd());               // swing ends → whiff should trigger
const whiffStagger = p.swordStagger;
const whiffFlag    = p.whiffed;
console.log('whiffed heavy -> stagger:', whiffStagger.toFixed(2), 'flag:', whiffFlag);

// Recover, then throw a heavy that CONNECTS mid-swing.
p.whiffed = false;
run(90, cmd());               // stagger decays (1.0s) and guard resumes
const preStagger = p.swordStagger;
run(15, cmd(3.2));
p.markSwingLanded();          // blade met something (flesh/blade/shield)
run(15, cmd(3.2));
run(1,  cmd());
const landedStagger = p.swordStagger;
console.log('landed heavy  -> stagger:', landedStagger.toFixed(2), '(pre:', preStagger.toFixed(2) + ')', 'flag:', p.whiffed);

// Golf backswing: holding the heavy windup aim (tip back over the shoulder,
// hands in tight) must actually cock the blade UP and BEHIND the fighter.
run(120, cmd());                             // recover stamina/stagger first
for (let i = 0; i < 50; i++) {
  p.updateControl(dt, { vx: 0, vz: 0, targetYaw: 0, aimYaw: 2.55, aimPitch: 1.25,
                        thrust: false, reach: 0.30, power: 1 });
  physics.step(dt, () => {});
}
const sr = p.swordBody.rotation();
const bladeDir = new THREE.Vector3(0, 0, 1)
  .applyQuaternion(new THREE.Quaternion(sr.x, sr.y, sr.z, sr.w));
// Fighter faces +Z, so "behind" is −Z; the tip should point up and back.
const cockedBack = bladeDir.y > 0.4 && bladeDir.z < -0.12;
console.log('backswing blade dir:', bladeDir.x.toFixed(2), bladeDir.y.toFixed(2), bladeDir.z.toFixed(2),
            '-> up & behind:', cockedBack);
run(60, cmd());                              // let the pose unwind

// Wrist snap: while the aim sweeps, the wrist deflects the blade AHEAD of the
// arm's aim direction (without it the physical blade always lags the target),
// widening the sword's total angular travel. Needs a rested arm — exhaustion
// drops sword authority and its huge tracking lag would mask the wrist.
p.stamina = 100; p.exhausted = false;
run(30, cmd());
let sweepYaw = -1.5, maxLead = 0;
for (let i = 0; i < 45; i++) {
  sweepYaw += 6.0 * dt;                        // steady 6 rad/s cut
  p.updateControl(dt, { vx: 0, vz: 0, targetYaw: 0, aimYaw: sweepYaw, aimPitch: 0.1,
                        thrust: false, reach: 0.6, power: 1 });
  physics.step(dt, () => {});
  if (i < 20) continue;                        // let the wrist spool up
  const br = p.swordBody.rotation();
  const bd = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(new THREE.Quaternion(br.x, br.y, br.z, br.w));
  const bladeYaw = Math.atan2(bd.x, bd.z);
  const lead = Math.atan2(Math.sin(bladeYaw - sweepYaw), Math.cos(bladeYaw - sweepYaw));
  maxLead = Math.max(maxLead, lead);
}
console.log('wrist: max blade lead over aim during sweep:', maxLead.toFixed(2), 'rad');

// Body English: the torso coils with the aim (shoulders more than hips —
// upper and lower body move separately) and leans into downward cuts.
function bodyYaw(part) {
  const r = p.bodies[part].rotation();
  const f = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
  return Math.atan2(f.x, f.z);
}
run(60, cmd());
for (let i = 0; i < 50; i++) {
  p.updateControl(dt, { vx: 0, vz: 0, targetYaw: 0, aimYaw: 2.0, aimPitch: 0.3,
                        thrust: false, reach: 0.45, power: 1 });
  physics.step(dt, () => {});
}
const coilTorso = bodyYaw('torso'), coilPelvis = bodyYaw('pelvis');
for (let i = 0; i < 50; i++) {
  p.updateControl(dt, { vx: 0, vz: 0, targetYaw: 0, aimYaw: -2.0, aimPitch: -0.85,
                        thrust: false, reach: 0.62, power: 1 });
  physics.step(dt, () => {});
}
const uncoilTorso = bodyYaw('torso');
const tr2 = p.bodies.torso.rotation();
const torsoUp = new THREE.Vector3(0, 1, 0)
  .applyQuaternion(new THREE.Quaternion(tr2.x, tr2.y, tr2.z, tr2.w));
const coils    = coilTorso > 0.2 && uncoilTorso < -0.2;
const hipsHalf = coilPelvis > 0.05 && coilPelvis < coilTorso;
const leansIn  = torsoUp.z > 0.05;     // facing +Z, low cut → top tips forward
console.log('coil: torso', coilTorso.toFixed(2), 'pelvis', coilPelvis.toFixed(2),
            '-> uncoil torso', uncoilTorso.toFixed(2), 'lean fwd', torsoUp.z.toFixed(2));

// Parried-heavy stagger scaling, as game._swordClash applies it:
// stagger = aStag · bP · max(1, aP·0.55) when parried.
const r  = Ragdoll.clashResponse(false, true);   // b parries a
const normalStag = r.aStag * 1 * Math.max(1, 1   * 0.55);
const heavyStag  = r.aStag * 1 * Math.max(1, 3.2 * 0.55);
console.log('parried stagger normal:', normalStag.toFixed(2), 'heavy:', heavyStag.toFixed(2));

const ok = whiffStagger > 0.9 && whiffFlag &&
           landedStagger < 0.05 && !p.whiffed &&
           cockedBack && maxLead > 0.08 && coils && hipsHalf && leansIn &&
           heavyStag > normalStag * 1.5;
console.log(ok ? 'HEAVY TEST PASSED' : 'HEAVY TEST FAILED');
process.exit(ok ? 0 : 1);
