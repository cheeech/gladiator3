// Headless test: an AI fighter keeps moving (circling/bobbing) instead of
// standing still, and dashes clear when an incoming blade is fast.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld, groups,
         G_WORLD, G_P_BODY, G_P_WPN, G_E_BODY, G_E_WPN } from '../src/physics.js';
import { Ragdoll } from '../src/ragdoll.js';
import { EnemyAI } from '../src/ai.js';

// The AI's footwork and defensive reactions are probabilistic. Seed Math.random
// so this test is deterministic instead of flaky across runs.
let _seed = 0x1a2b3c4d;
Math.random = () => {
  _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

await RAPIER.init();
const scene   = new THREE.Scene();
const physics = new PhysicsWorld(RAPIER);
physics.buildArenaStatics();

const foe = new Ragdoll(scene, physics, {     // the target it circles
  x: 1.8, z: 0, facing: -Math.PI / 2,
  bodyGroups:   groups(G_P_BODY, G_WORLD | G_E_BODY | G_E_WPN),
  weaponGroups: groups(G_P_WPN,  G_WORLD | G_E_BODY | G_E_WPN),
});
const fighter = new Ragdoll(scene, physics, { // the AI we measure
  x: 0, z: 0, facing: Math.PI / 2,
  bodyGroups:   groups(G_E_BODY, G_WORLD | G_P_BODY | G_P_WPN),
  weaponGroups: groups(G_E_WPN,  G_WORLD | G_P_BODY | G_P_WPN),
});
const ai = new EnemyAI(fighter, foe, { sparring: false });

const dt = 1 / 60;
const foeCmd = { vx: 0, vz: 0, targetYaw: -Math.PI / 2, aimYaw: 0.3, aimPitch: 0.25, thrust: false, reach: 0.52 };

// ── Part 1: it keeps moving ────────────────────────────────────────────────
let prev = fighter.pelvisPos();
let path = 0, moving = 0, frames = 0;
for (let i = 0; i < 60 * 6; i++) {
  fighter.updateControl(dt, ai.update(dt));
  foe.updateControl(dt, foeCmd);
  physics.step(dt, () => {});
  const cur = fighter.pelvisPos();
  const d = Math.hypot(cur.x - prev.x, cur.z - prev.z);
  path += d;
  if (d / dt > 0.25) moving++;     // counts as "in motion" this frame
  frames++;
  prev = cur;
}
const start = new THREE.Vector3(0, 0, 0);
const end   = fighter.pelvisPos();
const net   = Math.hypot(end.x - start.x, end.z - start.z);
const avgSpeed   = path / (frames * dt);
const movingFrac = moving / frames;
const wander     = path / Math.max(0.01, net);   // path ≫ net displacement = circling
console.log('avg speed:', avgSpeed.toFixed(2), 'm/s  moving fraction:', movingFrac.toFixed(2),
            '  path/net:', wander.toFixed(1));

// ── Part 2: it defends against incoming blades ──────────────────────────────
// Reacting is probabilistic (one decision per strike) and the fighter now picks
// between a dash and a block, so feed a series of fake strikes (blade fast, then
// idle to re-arm) and confirm it defends — dodges OR parries — some of them.
const ai2 = new EnemyAI(fighter, foe, { sparring: false });
let defends = 0, prevCd = fighter.dodgeCd, prevParry = false, phase = 0;
for (let i = 0; i < 60 * 4; i++) {
  phase += dt;
  const hot = (phase % 0.4) < 0.2;     // strike, pause, strike, pause...
  foe.swordStrikeVelocity = () => ({ length: () => (hot ? 12 : 0) });
  fighter.updateControl(dt, ai2.update(dt));
  foe.updateControl(dt, foeCmd);
  physics.step(dt, () => {});
  if (fighter.dodgeCd > prevCd + 0.01) defends++;        // cd jumped up = a dash fired
  if (fighter.parrying && !prevParry) defends++;         // rising edge = a block raised
  prevCd = fighter.dodgeCd;
  prevParry = fighter.parrying;
}
const defended = defends > 0;
console.log('defensive reactions over 4s of intermittent strikes:', defends);

const movesConstantly = avgSpeed > 0.5 && movingFrac > 0.6 && wander > 1.8;
const ok = movesConstantly && defended;
console.log('moves constantly:', movesConstantly, ' defends:', defended);
console.log(ok ? 'FOOTWORK TEST PASSED' : 'FOOTWORK TEST FAILED');
process.exit(ok ? 0 : 1);
process.exit(ok ? 0 : 1);
