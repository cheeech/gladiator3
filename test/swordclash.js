// Headless test for sword-on-sword physics:
//  1. Two opposing blades actually register a weapon↔weapon collision (the
//     groups + solid colliders that the clash response is built on).
//  2. staggerSword() suspends the sword PD controller, so a parry deflects the
//     blade instead of it being instantly re-aimed.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld, groups,
         G_WORLD, G_P_BODY, G_P_WPN, G_E_BODY, G_E_WPN } from '../src/physics.js';
import { Ragdoll } from '../src/ragdoll.js';

await RAPIER.init();
const scene   = new THREE.Scene();
const physics = new PhysicsWorld(RAPIER);
physics.buildArenaStatics();

const player = new Ragdoll(scene, physics, {
  x: -0.4, z: 0, facing:  Math.PI / 2,
  bodyGroups:   groups(G_P_BODY, G_WORLD | G_E_BODY | G_E_WPN),
  weaponGroups: groups(G_P_WPN,  G_WORLD | G_E_BODY | G_E_WPN),
});
const enemy = new Ragdoll(scene, physics, {
  x:  0.4, z: 0, facing: -Math.PI / 2,
  bodyGroups:   groups(G_E_BODY, G_WORLD | G_P_BODY | G_P_WPN),
  weaponGroups: groups(G_E_WPN,  G_WORLD | G_P_BODY | G_P_WPN),
});

const dt = 1 / 60;
const q  = new THREE.Quaternion();
const neutral = (yaw) => ({ vx: 0, vz: 0, targetYaw: yaw, aimYaw: 0, aimPitch: 0, thrust: false, reach: 0.52 });

// ── Test 1: do the two blades collide? ────────────────────────────────────
for (let i = 0; i < 90; i++) {
  player.updateControl(dt, neutral(Math.PI / 2));
  enemy.updateControl(dt, neutral(-Math.PI / 2));
  physics.step(dt, () => {});
}
// Force the enemy blade onto the player's blade and let it resolve.
const pt = player.swordBody.translation();
enemy.swordBody.setTranslation({ x: pt.x, y: pt.y, z: pt.z }, true);

let weaponContact = false;
for (let i = 0; i < 30; i++) {
  player.updateControl(dt, neutral(Math.PI / 2));
  enemy.updateControl(dt, neutral(-Math.PI / 2));
  physics.step(dt, (m1, m2) => {
    if (m1.kind === 'weapon' && m2.kind === 'weapon') weaponContact = true;
  });
}
console.log('weapon↔weapon collision fired:', weaponContact);

// ── Test 2: stagger suspends sword aiming ──────────────────────────────────
function bladeY() {
  const r = player.swordBody.rotation();
  q.set(r.x, r.y, r.z, r.w);
  return new THREE.Vector3(0, 0, 1).applyQuaternion(q).y;   // +1 = pointing up
}
const aimUp = { vx: 0, vz: 0, targetYaw: Math.PI / 2, aimYaw: 0, aimPitch: 1.3, thrust: false, reach: 0.52 };

// Without stagger: blade should swing up to follow the aim.
for (let i = 0; i < 50; i++) { player.updateControl(dt, aimUp); physics.step(dt, () => {}); }
const freeY = bladeY();

// Re-settle, then stagger and command the same aim — blade should NOT follow.
for (let i = 0; i < 60; i++) { player.updateControl(dt, neutral(Math.PI / 2)); physics.step(dt, () => {}); }
const settledY = bladeY();
player.staggerSword(2.0);
for (let i = 0; i < 40; i++) { player.updateControl(dt, aimUp); physics.step(dt, () => {}); }
const staggeredY = bladeY();

console.log('blade tip-up:  free aim:', freeY.toFixed(2), ' staggered:', staggeredY.toFixed(2), ' (settled', settledY.toFixed(2) + ')');

// ── Test 3: roll spin is bled off ──────────────────────────────────────────
// The blade's roll inertia is ~400x smaller than transverse — a clash torque
// along the blade axis used to spin it up like a drill for seconds. The
// controller must bleed that roll velocity fast, even while staggered.
function rollRate() {
  const r = player.swordBody.rotation();
  q.set(r.x, r.y, r.z, r.w);
  const bd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const av = player.swordBody.angvel();
  return av.x * bd.x + av.y * bd.y + av.z * bd.z;
}
{
  // Set the roll component to exactly +60 (contacts from the overlapped test
  // blades can leave tens of rad/s of roll at any given frame, so ADDING
  // would land at an unpredictable total).
  const r = player.swordBody.rotation();
  q.set(r.x, r.y, r.z, r.w);
  const bd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const av = player.swordBody.angvel();
  const r0 = av.x * bd.x + av.y * bd.y + av.z * bd.z;
  player.swordBody.setAngvel(
    { x: av.x + bd.x * (60 - r0), y: av.y + bd.y * (60 - r0), z: av.z + bd.z * (60 - r0) }, true);
}
player.staggerSword(1.0);                        // worst case: controller off
const spunUp = Math.abs(rollRate());
for (let i = 0; i < 30; i++) { player.updateControl(dt, neutral(Math.PI / 2)); physics.step(dt, () => {}); }
const spunDown = Math.abs(rollRate());
console.log('roll spin: injected', spunUp.toFixed(0), 'rad/s -> after 0.5s:', spunDown.toFixed(1), 'rad/s');

const collides    = weaponContact;
const aimsWhenFree = freeY > 0.4;                 // control raises the blade
const heldByParry  = staggeredY < freeY - 0.3;    // stagger blocks the re-aim
const rollBled     = spunUp > 50 && spunDown < 4; // drill-spin killed fast
const ok = collides && aimsWhenFree && heldByParry && rollBled;
console.log(ok ? 'SWORD CLASH TEST PASSED' : 'SWORD CLASH TEST FAILED');
process.exit(ok ? 0 : 1);
