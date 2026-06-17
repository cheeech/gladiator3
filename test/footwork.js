// Headless test: an AI fighter keeps moving (circling/bobbing) instead of
// standing still, and dashes clear when an incoming blade is fast.
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

// ── Part 2: it dodges a fast incoming blade ────────────────────────────────
const ai2 = new EnemyAI(fighter, foe, { sparring: false });
ai2.state = 'APPROACH';
foe.swordStrikeVelocity = () => ({ length: () => 12 });   // fake a fast incoming cut
fighter.dodgeCd = 0; fighter.stamina = 100;
const cdBefore = fighter.dodgeCd;
ai2.update(dt);                                            // should trigger a dash
const dodged = fighter.dodgeCd > 0;
console.log('dodge fired on incoming blade:', dodged);

const movesConstantly = avgSpeed > 0.5 && movingFrac > 0.6 && wander > 2;
const ok = movesConstantly && dodged;
console.log('moves constantly:', movesConstantly, ' dodges:', dodged);
console.log(ok ? 'FOOTWORK TEST PASSED' : 'FOOTWORK TEST FAILED');
process.exit(ok ? 0 : 1);
