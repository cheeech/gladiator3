// Headless smoke test: build the physics scene, run 10 simulated seconds,
// verify the ragdolls stand, swing, and damage resolution works.
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

const player = new Ragdoll(scene, physics, {
  x: -2, z: 0, facing:  Math.PI / 2,
  bodyGroups:   groups(G_P_BODY, G_WORLD | G_E_BODY | G_E_WPN),
  weaponGroups: groups(G_P_WPN,  G_WORLD | G_E_BODY | G_E_WPN),
});
const enemy = new Ragdoll(scene, physics, {
  x:  2, z: 0, facing: -Math.PI / 2,
  bodyGroups:   groups(G_E_BODY, G_WORLD | G_P_BODY | G_P_WPN),
  weaponGroups: groups(G_E_WPN,  G_WORLD | G_P_BODY | G_P_WPN),
});
const ai = new EnemyAI(enemy, player);

const dt = 1 / 60;
let contacts = 0;
let maxBladeSpeed = 0;
const aim = { yaw: 0.3, pitch: 0.25 };

for (let i = 0; i < 600; i++) {
  const t = i * dt;

  const pp = player.pelvisPos(), ep = enemy.pelvisPos();
  const dx = ep.x - pp.x, dz = ep.z - pp.z;
  const dist = Math.hypot(dx, dz);
  const targetYaw = Math.atan2(dx, dz);
  const advance = dist > 1.5;

  // Emulate the game's windup -> release cycle (starts after 2s)
  let reach;
  const cycle = t % 1.4;
  if (t < 2 || cycle < 0.6) {            // guard
    const k = Math.min(1, dt * 5);
    aim.yaw += (0.3 - aim.yaw) * k; aim.pitch += (0.25 - aim.pitch) * k;
  } else if (cycle < 1.1) {              // windup (LMB held)
    const k = Math.min(1, dt * 10);
    aim.yaw += (-1.5 - aim.yaw) * k; aim.pitch += (0.45 - aim.pitch) * k;
    reach = 0.40;
  } else {                               // swing (LMB released)
    const k = Math.min(1, dt * 22);
    aim.yaw += (1.3 - aim.yaw) * k; aim.pitch += (0.1 - aim.pitch) * k;
    reach = 0.62;
    maxBladeSpeed = Math.max(maxBladeSpeed, player.swordStrikeVelocity().length());
  }

  player.updateControl(dt, {
    vx: advance ? (dx / dist) * 3 : 0,
    vz: advance ? (dz / dist) * 3 : 0,
    targetYaw, aimYaw: aim.yaw, aimPitch: aim.pitch, thrust: false, reach,
  });
  enemy.updateControl(dt, ai.update(dt));

  physics.step(dt, (m1, m2) => {
    contacts++;
    if (m1.kind === 'weapon' && m2.kind === 'part' && m1.ref !== m2.ref) {
      const speed = m1.ref.swordStrikeVelocity().length();
      if (speed > 1.6) m2.ref.applyDamage(m2.part, (speed - 1.2) * 11);
    }
  });

  // Capture calm standing tilt just before the player starts swinging
  if (i === 110) {
    globalThis.standingTilt = (r => {
      const q = r.bodies.torso.rotation();
      const up = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
      return Math.acos(Math.min(1, up.y)) * 180 / Math.PI;
    })(player);
  }

  // NaN / explosion check every 60 frames
  if (i % 60 === 0) {
    for (const r of [player, enemy]) {
      const p = r.pelvisPos();
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))
        throw new Error(`NaN pelvis at t=${t.toFixed(1)}s`);
      if (Math.abs(p.x) > 50 || p.y > 20 || Math.abs(p.z) > 50)
        throw new Error(`Ragdoll exploded at t=${t.toFixed(1)}s: ${JSON.stringify(p)}`);
    }
  }
}

// Torso tilt from vertical (degrees) — slouch check
function torsoTiltDeg(r) {
  const q = r.bodies.torso.rotation();
  const up = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  return Math.acos(Math.min(1, up.y)) * 180 / Math.PI;
}

const pH = player.pelvisPos().y;
const eH = enemy.pelvisPos().y;
console.log(`player torso tilt: ${torsoTiltDeg(player).toFixed(1)}°  enemy torso tilt: ${torsoTiltDeg(enemy).toFixed(1)}°`);
console.log(`player pelvis height: ${pH.toFixed(2)} (alive=${player.alive}, knocked=${player.knocked})`);
console.log(`enemy  pelvis height: ${eH.toFixed(2)} (alive=${enemy.alive}, knocked=${enemy.knocked})`);
console.log(`contact events: ${contacts}`);
console.log(`player hp: ${(player.totalHpFraction() * 100).toFixed(0)}%  enemy hp: ${(enemy.totalHpFraction() * 100).toFixed(0)}%`);

console.log(`player standing tilt (pre-swing): ${globalThis.standingTilt.toFixed(1)}°`);
if (globalThis.standingTilt > 15) throw new Error('player slouching: standing tilt > 15°');
if (player.alive && pH < 0.5) throw new Error('player ragdoll collapsed while alive');
console.log(`max blade speed during swings: ${maxBladeSpeed.toFixed(1)} m/s`);
if (maxBladeSpeed < 4) throw new Error('released swings too slow to deal damage');
if (contacts === 0) throw new Error('no physics contacts at all — collision groups broken?');
console.log('SMOKE TEST PASSED');
