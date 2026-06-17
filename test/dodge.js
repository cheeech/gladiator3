// Headless test for evasion:
//  - tryDodge() lurches the whole body, costs stamina, and respects cooldown.
//  - Ragdoll.clashResponse() resolves parries (brace the blocker, punish the
//    attacker) vs even clashes.
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

const dt = 1 / 60;
const neutral = { vx: 0, vz: 0, targetYaw: Math.PI / 2, aimYaw: 0.3, aimPitch: 0.25, thrust: false, reach: 0.52 };
const step = (n) => { for (let i = 0; i < n; i++) { p.updateControl(dt, neutral); physics.step(dt, () => {}); } };

// Settle, then measure idle drift over 0.5 s as a baseline.
step(120);
let x = p.pelvisPos().x;
step(30);
const baseline = Math.abs(p.pelvisPos().x - x);

// Dodge in +x and measure displacement over the same window.
const stamBefore = p.stamina;
const fired      = p.tryDodge(1, 0);
const stamCost   = stamBefore - p.stamina;
const cdBlocked  = p.tryDodge(1, 0);   // immediately again → should be blocked
const x0 = p.pelvisPos().x;
step(30);
const dodgeDisp = p.pelvisPos().x - x0;

console.log('idle drift:', baseline.toFixed(2), ' dodge displacement:', dodgeDisp.toFixed(2));
console.log('fired:', fired, ' cooldown blocked 2nd:', !cdBlocked, ' stamina cost:', stamCost.toFixed(0));

// ── Parry resolution (pure helper used by game.js _swordClash) ──────────────
const even = Ragdoll.clashResponse(false, false);
const aPar = Ragdoll.clashResponse(true,  false);   // a blocks b's attack
const bPar = Ragdoll.clashResponse(false, true);    // b blocks a's attack
console.log('even clash:', JSON.stringify(even));
console.log('a parries:', JSON.stringify(aPar));

const dodgeOk = fired && !cdBlocked && dodgeDisp > 0.3 && dodgeDisp > baseline + 0.2 && stamCost > 25;
const parryOk =
  !even.parry && even.aStag === even.bStag &&
  aPar.parry && aPar.aStag === 0 && aPar.bStag > 0 && aPar.bStam > 0 && aPar.bMul > aPar.aMul &&
  bPar.parry && bPar.bStag === 0 && bPar.aStag > 0 && bPar.aStam > 0 && bPar.aMul > bPar.bMul;

const ok = dodgeOk && parryOk;
console.log('dodge ok:', dodgeOk, ' parry ok:', parryOk);
console.log(ok ? 'DODGE/PARRY TEST PASSED' : 'DODGE/PARRY TEST FAILED');
process.exit(ok ? 0 : 1);
