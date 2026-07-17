import * as THREE from 'three';
import { PhysicsWorld, groups,
         G_WORLD, G_P_BODY, G_P_WPN, G_E_BODY, G_E_WPN } from './physics.js';
import { Ragdoll }           from './ragdoll.js';
import { EnemyAI }           from './ai.js';
import { ThirdPersonCamera } from './camera.js';
import { buildArena }        from './arena.js';
import { audio }             from './audio.js';
import { GlbAvatar }         from './skin.js';

const ENEMY_IDLE     = true;  // sparring mode: enemy holds ground and randomly
                              // swings. Set false for the aggressive chasing AI.
const PLAYER_SPEED   = 4.5;
const DUCK_STRAFE    = 3.5;   // extra lateral lunge speed while ducking (A/D)
const GUARD_YAW      = 0.30;
const GUARD_PITCH    = 0.25;
const GUARD_REACH    = 0.52;
const WINDUP_REACH   = 0.40;  // sword pulled in close while cocked
const SWING_REACH    = 0.62;
const THRUST_REACH   = 0.85;
const SWING_TIME     = 0.34;  // seconds for the strike sweep
// Heavy swing: hold the windup (LMB) past HEAVY_CHARGE_TIME to load a big,
// committed blow — a huge arc, longer reach, and far more damage. It's a
// high-risk move: the charge is a slow, readable telegraph; it dumps a big
// chunk of stamina; a whiffed heavy (touches nothing) leaves you overswung
// and staggered; and a parried/blocked one staggers you in proportion to the
// power you swung with. A blocked heavy also drives the blocking blade/shield
// — and the body behind it — back correspondingly harder.
// Windup arc: the aim rides a time-parametrized curve into the chamber —
// smoothstep easing with the pitch lifted mid-path — so the tip circles
// up-and-over backward (a moulinet) instead of snapping along a chord.
const WINDUP_ARC_TIME   = 0.35;  // s for the backswing arc to complete
const WINDUP_ARC_LIFT   = 0.5;   // extra pitch at the arc's midpoint (rad)
const HEAVY_CHARGE_TIME = 0.75;  // hold the windup this long — the telegraph
const HEAVY_SWING_TIME  = 0.58;  // the huge arc takes longer to sweep
const HEAVY_SWING_REACH = 1.02;  // arm extends much further on the heavy strike
const HEAVY_POWER       = 3.2;   // damage / knockback multiplier when it lands
const HEAVY_STAM_COST   = 45;    // big stamina dump committed to the swing
const MIN_HIT_SPEED  = 1.6;   // m/s — slower contacts do no damage
const PARRY_YAW      = 0.00;  // block guard: blade raised centred in front
const PARRY_PITCH    = 0.70;
const PARRY_REACH    = 0.55;
// Parry steering: hold a movement key while blocking to throw the block out to
// the side (A/D), low and down (S), or high overhead (W). Bigger arcs than the
// old fixed centre-block so the player can cover a wide spectrum of incoming cuts.
const PARRY_YAW_SIDE   = 1.15;  // lateral sweep of a side block (radians)
const PARRY_LOW_PITCH  = -0.65; // a low block, blade swept down across the legs
const PARRY_HIGH_PITCH =  1.20; // a high block raised overhead
const PARRY_SIDE_REACH = 0.74;  // arm extends further on a side/low block

// Random deflection spin for a clash — but never about the blade's own long
// axis (its roll inertia is tiny, so roll torque spins it up like a drill),
// and capped so a heavy's scaled impulse twists the blade rather than
// windmilling it end over end.
function deflectSpin(body, mag) {
  mag = Math.min(mag, 0.8);
  const r = body.rotation();
  const bd = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
  const t = new THREE.Vector3(
    (Math.random() - 0.5) * mag,
    (Math.random() - 0.5) * mag,
    (Math.random() - 0.5) * mag);
  t.addScaledVector(bd, -t.dot(bd));   // strip the roll component
  body.applyTorqueImpulse({ x: t.x, y: t.y, z: t.z }, true);
}

export class Game {
  constructor(RAPIER, input, onGameOver, { auto = false } = {}) {
    this.input       = input;
    this._onGameOver = onGameOver;
    this._over       = false;
    this.auto        = auto;   // both avatars AI-driven, player just watches

    this.aimYaw   = GUARD_YAW;
    this.aimPitch = GUARD_PITCH;
    // Attack state machine: guard -> windup (LMB held) -> swing (LMB released)
    this.attack   = { state: 'guard', timer: 0, strike: null, reach: GUARD_REACH, thrust: false,
                      charge: 0, heavy: false, power: 1,
                      from: { yaw: GUARD_YAW, pitch: GUARD_PITCH } };
    this._hitCd   = { player: 0, enemy: 0 };
    this._clangCd = 0;
    this.crouch   = 0;   // 0..1 duck amount, smoothed from the crouch key

    this._setupRenderer();
    this._setupScene();

    this.physics = new PhysicsWorld(RAPIER);
    this.physics.buildArenaStatics();
    buildArena(this.scene);

    this.player = new Ragdoll(this.scene, this.physics, {
      x: -2, z: 0, facing:  Math.PI / 2,
      bodyColor: 0xb08040, helmetColor: 0x999999,
      bodyGroups:   groups(G_P_BODY, G_WORLD | G_E_BODY | G_E_WPN),
      weaponGroups: groups(G_P_WPN,  G_WORLD | G_E_BODY | G_E_WPN),
    });
    this.enemy = new Ragdoll(this.scene, this.physics, {
      x:  2, z: 0, facing: -Math.PI / 2,
      bodyColor: 0x6b1e1e, helmetColor: 0x3a3a3a,
      bodyGroups:   groups(G_E_BODY, G_WORLD | G_P_BODY | G_P_WPN),
      weaponGroups: groups(G_E_WPN,  G_WORLD | G_P_BODY | G_P_WPN),
      hasWeapon: true,   // armed so blades can clash
    });
    // Enemy AI: sparring (stand + random swings) unless we're auto-battling,
    // where it fights aggressively. In auto mode a second AI drives the player.
    this.ai = new EnemyAI(this.enemy, this.player, { sparring: ENEMY_IDLE && !auto });
    if (auto) this.playerAI = new EnemyAI(this.player, this.enemy, { sparring: false });

    const cam = new THREE.PerspectiveCamera(
      65, window.innerWidth / window.innerHeight, 0.1, 120
    );
    this.camera = new ThirdPersonCamera(cam);
    this.camera.yaw = -Math.PI / 2; // behind player, looking at enemy
    this.camera.update(this.player.pelvisPos(), 0, 0);

    this.lastTime = 0;
    this._onResize = () => {
      cam.aspect = window.innerWidth / window.innerHeight;
      cam.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', this._onResize);
  }

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled   = true;
    this.renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    document.body.appendChild(this.renderer.domElement);
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x90c8f0);
    this.scene.fog = new THREE.Fog(0x90c8f0, 28, 55);
  }

  start() {
    document.getElementById('hud').style.display       = 'flex';
    // No crosshair when you're just spectating an auto-battle.
    document.getElementById('crosshair').style.display = this.auto ? 'none' : 'block';
    document.getElementById('lock-prompt').style.display = 'none';
    this._partBars = {
      player: this._buildPartBars('player-parts', this.player),
      enemy:  this._buildPartBars('enemy-parts',  this.enemy),
    };

    // Drape the rigged gladiator GLB over each fighter (tinted per side). Each
    // falls back to its box meshes if the model fails to load.
    this.skins = [
      new GlbAvatar(this.scene, this.player, { tint: 0xb08040 }),
      new GlbAvatar(this.scene, this.enemy,  { tint: 0x6b1e1e }),
    ];

    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this._loop());
  }

  // Build one labeled mini health bar per body part; return refs for updating.
  _buildPartBars(containerId, fighter) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    return fighter.partHealth().map(({ name }) => {
      const row   = document.createElement('div');
      row.className = 'part-row';
      const label = document.createElement('span');
      label.className   = 'pname';
      label.textContent = name.replace(/_/g, ' ').toUpperCase();
      const bar  = document.createElement('div');
      bar.className = 'pbar';
      const fill = document.createElement('div');
      fill.className = 'pfill';
      bar.appendChild(fill);
      row.append(label, bar);
      container.appendChild(row);
      return { fill, label };
    });
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    if (this.skins) for (const s of this.skins) s.dispose();
    window.removeEventListener('resize', this._onResize);
    this.renderer.domElement.remove();
    this.renderer.dispose();
    document.getElementById('hud').style.display        = 'none';
    document.getElementById('crosshair').style.display  = 'none';
    document.getElementById('lock-prompt').style.display = 'block';
    const msg = document.getElementById('message');
    msg.style.opacity = '0';
    msg.textContent   = '';
  }

  _loop() {
    const now = performance.now();
    const dt  = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    const { mouse } = this.input;

    // Mouse always orbits the camera — the crosshair is where you aim
    this.camera.update(this.player.pelvisPos(), mouse.dx, mouse.dy);
    this.input.flush();

    // ── Player command ─────────────────────────────────────────────────────
    if (this.auto) {
      // Auto-battle: a second AI drives the "player" avatar — just watch.
      this.player.updateControl(dt, this.playerAI.update(dt));
    } else {
      // Parry (hold RMB): raise a block guard; you can't wind up while blocking.
      // Movement keys steer the block out to the side / low / high so the player
      // can swing the parry across a wide arc to meet the incoming cut.
      const parrying = !!mouse.buttons[2] && this.player.alive;
      this.player.parrying = parrying;
      if (parrying) {
        const pose = this._parryPose();
        const k = Math.min(1, dt * 12);
        this.aimYaw   += (pose.yaw   - this.aimYaw)   * k;
        this.aimPitch += (pose.pitch - this.aimPitch) * k;
        this.attack.state  = 'guard';
        this.attack.thrust = false;
        this.attack.reach += (pose.reach - this.attack.reach) * k;
      } else {
        this._updateAttack(dt, !!mouse.buttons[0]);
      }

      const fwd   = this.camera.forward;
      const right = this.camera.right;
      const aIn = this.input.isDown('KeyA', 'ArrowLeft');
      const dIn = this.input.isDown('KeyD', 'ArrowRight');
      let mx = 0, mz = 0;
      if (this.input.isDown('KeyW', 'ArrowUp'))    { mx += fwd.x;   mz += fwd.z;   }
      if (this.input.isDown('KeyS', 'ArrowDown'))  { mx -= fwd.x;   mz -= fwd.z;   }
      if (aIn) { mx -= right.x; mz -= right.z; }
      if (dIn) { mx += right.x; mz += right.z; }
      const len = Math.hypot(mx, mz);
      let vx = len > 0 ? (mx / len) * PLAYER_SPEED : 0;
      let vz = len > 0 ? (mz / len) * PLAYER_SPEED : 0;

      // Dodge (tap Space): evasive burst in the move direction, else backpedal.
      const dodgeKey = this.input.isDown('Space');
      if (dodgeKey && !this._dodgePrev) {
        let ddx = mx, ddz = mz;
        if (Math.hypot(ddx, ddz) < 1e-3) { ddx = -fwd.x; ddz = -fwd.z; }
        this.player.tryDodge(ddx, ddz);
      }
      this._dodgePrev = dodgeKey;

      // Duck/crouch (hold Shift or C): drop the body low. With A/D held the duck
      // weaves hard to that side — a ducking sidestep, not just a drop.
      const ducking = this.input.isDown('ShiftLeft', 'ShiftRight', 'KeyC');
      this.crouch += ((ducking ? 1 : 0) - this.crouch) * Math.min(1, dt * 9);
      const lat = (dIn ? 1 : 0) - (aIn ? 1 : 0);
      vx += right.x * lat * DUCK_STRAFE * this.crouch;
      vz += right.z * lat * DUCK_STRAFE * this.crouch;

      this.player.updateControl(dt, {
        vx, vz,
        crouch: this.crouch,
        targetYaw: this.camera.playerFacing,
        aimYaw:    this.aimYaw,
        aimPitch:  this.aimPitch,
        thrust:    this.attack.thrust,
        reach:     this.attack.reach,
        power:     this.attack.power,
      });
    }

    // ── Enemy command ──────────────────────────────────────────────────────
    this.enemy.updateControl(dt, this.ai.update(dt));

    // Flash "PARRY" above whichever fighter just raised a block this frame.
    this._announceParries();

    // ── Physics + impact damage ───────────────────────────────────────────
    this._hitCd.player = Math.max(0, this._hitCd.player - dt);
    this._hitCd.enemy  = Math.max(0, this._hitCd.enemy  - dt);
    this._clangCd      = Math.max(0, this._clangCd - dt);

    this.physics.step(dt, (m1, m2) => this._onContact(m1, m2));

    this.player.syncMeshes();
    this.enemy.syncMeshes();
    if (this.skins) for (const s of this.skins) s.update();

    this._updateHUD();
    this._checkWinLose();

    this.renderer.render(this.scene, this.camera.cam);
  }

  // ── Attack state machine ──────────────────────────────────────────────
  // guard:  sword relaxed at guard pose
  // windup: LMB held — sword cocks back opposite the chosen path
  // swing:  LMB released — aim target whips along the path, physics swings
  _updateAttack(dt, lmb) {
    const atk = this.attack;

    // Vertical centre of the strike comes from where the camera points
    const basePitch = THREE.MathUtils.clamp((0.35 - this.camera.pitch) * 1.6, -0.55, 0.55);

    if (atk.state === 'guard') {
      const k = Math.min(1, dt * 5);
      this.aimYaw   += (GUARD_YAW   - this.aimYaw)   * k;
      this.aimPitch += (GUARD_PITCH - this.aimPitch) * k;
      atk.reach  = GUARD_REACH;
      atk.thrust = false;
      atk.power  = 1;
      if (lmb && this.player.alive) {
        atk.state = 'windup'; atk.charge = 0; atk.heavy = false;
        atk.from  = { yaw: this.aimYaw, pitch: this.aimPitch };   // arc start
      }

    } else if (atk.state === 'windup') {
      // Holding the windup charges a heavy swing (needs the stamina to spend).
      atk.charge += dt;
      atk.heavy = atk.charge >= HEAVY_CHARGE_TIME && this.player.stamina > HEAVY_STAM_COST;
      // Re-read keys every frame so the path can be adjusted mid-windup.
      // The aim rides the windup arc: smoothstep from the guard pose it left
      // toward the chamber, pitch lifted mid-path so the tip circles
      // over-and-back rather than yanking sideways.
      const pose = this._swingPoses(basePitch, atk.heavy).windup;
      const s = Math.min(1, atk.charge / WINDUP_ARC_TIME);
      const e = s * s * (3 - 2 * s);
      const lift = WINDUP_ARC_LIFT * Math.sin(Math.PI * e);
      const ty = atk.from.yaw   + (pose.yaw   - atk.from.yaw)   * e;
      const tp = Math.min(2.0, atk.from.pitch + (pose.pitch - atk.from.pitch) * e + lift);
      const k = Math.min(1, dt * 14);
      this.aimYaw   += (ty - this.aimYaw)   * k;
      this.aimPitch += (tp - this.aimPitch) * k;
      atk.reach += ((pose.reach ?? WINDUP_REACH) - atk.reach) * k;
      if (!lmb) {
        const poses = this._swingPoses(basePitch, atk.heavy);
        atk.strike = poses.strike;
        atk.thrust = !!poses.strike.thrust;
        atk.timer  = atk.heavy ? HEAVY_SWING_TIME : SWING_TIME;
        atk.power  = atk.heavy ? HEAVY_POWER : 1;
        atk.state  = 'swing';
        if (atk.heavy) {
          this.player.stamina = Math.max(0, this.player.stamina - HEAVY_STAM_COST);
          const pp = this.player.pelvisPos();
          this._flashWorldText('HEAVY!', new THREE.Vector3(pp.x, pp.y + 1.2, pp.z), '#ff8c2a', 22);
        }
      }

    } else if (atk.state === 'swing') {
      const k = Math.min(1, dt * 22);   // fast target = fast blade
      this.aimYaw   += (atk.strike.yaw   - this.aimYaw)   * k;
      this.aimPitch += (atk.strike.pitch - this.aimPitch) * k;
      atk.reach = atk.strike.reach ?? (atk.thrust ? THRUST_REACH : SWING_REACH);
      atk.timer -= dt;
      if (atk.timer <= 0) { atk.state = 'guard'; atk.thrust = false; atk.power = 1; }
    }
  }

  // Block pose while parrying, steered by the movement keys so the guard can be
  // thrown across a wide arc. A/D sweep it far to the side, S drops it low and
  // down, W raises it high overhead; combine for diagonal blocks. No key holds
  // the default centred high guard.
  _parryPose() {
    const left  = this.input.isDown('KeyA', 'ArrowLeft');
    const right = this.input.isDown('KeyD', 'ArrowRight');
    const high  = this.input.isDown('KeyW', 'ArrowUp');
    const low   = this.input.isDown('KeyS', 'ArrowDown');

    let d = 0;
    if (right) d -= 1;   // aimYaw positive = screen-left, so D (right) is negative
    if (left)  d += 1;

    let yaw   = PARRY_YAW + d * PARRY_YAW_SIDE;
    let pitch = PARRY_PITCH;
    let reach = d !== 0 ? PARRY_SIDE_REACH : PARRY_REACH;

    if (low)  { pitch = PARRY_LOW_PITCH;  reach = PARRY_SIDE_REACH; }
    else if (high) { pitch = PARRY_HIGH_PITCH; }

    return { yaw, pitch, reach };
  }

  // Swing path from direction keys. aimYaw: positive = screen-left.
  // A/D = blade travels left/right, W = overhead chop, S = thrust,
  // S + A/D = low sweep (scythes the blade low — reaches downed/crawling foes).
  _swingPoses(basePitch, heavy = false) {
    const left     = this.input.isDown('KeyA', 'ArrowLeft');
    const right    = this.input.isDown('KeyD', 'ArrowRight');
    const overhead = this.input.isDown('KeyW', 'ArrowUp');
    const thrust   = this.input.isDown('KeyS', 'ArrowDown');

    // Travel direction: +1 = sweep toward screen-right. Default forehand
    // (winds up on the right, sweeps left) when no key is held.
    let d = 0;
    if (right) d += 1;
    if (left)  d -= 1;

    let p;
    if (thrust) {
      if (d !== 0) {
        // Low sweep: cock the blade low to one side, then scythe it across and
        // down with extended reach — the reliable way to hit a foe on the
        // ground, or to chop at a standing opponent's legs.
        p = {
          windup: { yaw:  2.0 * d, pitch: basePitch - 0.20, reach: 0.50 },
          strike: { yaw: -1.4 * d, pitch: basePitch - 0.85, reach: THRUST_REACH },
        };
      } else {
        p = {
          windup: { yaw: 0.15, pitch: basePitch + 0.05 },
          strike: { yaw: 0.00, pitch: basePitch, thrust: true },
        };
      }
    } else if (overhead) {
      p = {
        windup: { yaw: 0.35 * d + 0.1, pitch: basePitch + 1.15 },
        strike: { yaw: -0.90 * d,      pitch: basePitch - 0.55 },
      };
    } else if (d === 0) {
      // No direction held: pendulum backswing — pitch beyond vertical sends
      // the grip target up and behind the head, so the hand raises overhead
      // with the blade cocked back. Release whips it down into a stab.
      p = {
        windup: { yaw: 0.05, pitch: basePitch + 1.85, reach: 0.50 },
        strike: { yaw: 0.00, pitch: basePitch - 0.85, reach: THRUST_REACH, thrust: true },
      };
    } else {
      // Chamber well past the shoulder line so the blade swivels back behind
      // the body, then cut through past centre — not a poke.
      p = {
        windup: { yaw:  2.2 * d, pitch: basePitch + 0.55 },
        strike: { yaw: -1.55 * d, pitch: basePitch - 0.10 },
      };
    }

    // A heavy cocks into a golf-style backswing — hands pulled in tight while
    // the TIP sweeps back behind the shoulder and up (the visible telegraph) —
    // then whips down through a huge arc with extended reach.
    if (heavy) {
      const rel = p.windup.pitch - basePitch;   // how vertical this swing's windup is
      p.windup = rel >= 1.1
        // vertical swings (overhead / pendulum): cock clear over the back
        ? { ...p.windup, yaw: p.windup.yaw * 1.7, pitch: basePitch + 1.95, reach: 0.30 }
        // side/low cuts: tip back behind the windup-side shoulder and raised
        // (pitch capped short of vertical so the lean-back stays readable)
        : { ...p.windup,
            yaw:   THREE.MathUtils.clamp(p.windup.yaw * 1.7, -2.6, 2.6),
            pitch: Math.min(p.windup.pitch + 0.85, 1.25),
            reach: 0.30 };
      // Yaw clamped short of π — past it the scalar aim lerp sweeps the long
      // way round (a full-circle windmill).
      p.strike = { ...p.strike,
                   yaw:   THREE.MathUtils.clamp(p.strike.yaw * 2.3, -2.7, 2.7),
                   reach: HEAVY_SWING_REACH };
    }
    return p;
  }

  _onContact(m1, m2) {
    // weapon vs weapon → physical parry: deflect both blades apart
    if (m1.kind === 'weapon' && m2.kind === 'weapon') {
      this._swordClash(m1.ref, m2.ref);
      return;
    }

    // weapon vs shield → blocked: deflect the blade, no damage
    if ((m1.kind === 'weapon' && m2.kind === 'shield') ||
        (m2.kind === 'weapon' && m1.kind === 'shield')) {
      const wpn = m1.kind === 'weapon' ? m1.ref : m2.ref;
      const shd = m1.kind === 'shield' ? m1.ref : m2.ref;
      if (wpn !== shd) this._shieldBlock(wpn, shd);
      return;
    }

    // weapon vs body part
    let attacker = null, victim = null, part = null;
    if (m1.kind === 'weapon' && m2.kind === 'part' && m1.ref !== m2.ref) {
      attacker = m1.ref; victim = m2.ref; part = m2.part;
    } else if (m2.kind === 'weapon' && m1.kind === 'part' && m2.ref !== m1.ref) {
      attacker = m2.ref; victim = m1.ref; part = m1.part;
    }
    if (!attacker) return;
    attacker.markSwingLanded();   // blade met flesh — the swing is no whiff

    const who = attacker === this.player ? 'player' : 'enemy';
    if (this._hitCd[who] > 0) return;

    const strikeVel = attacker.swordStrikeVelocity();
    const partBody  = victim.bodies[part];
    const pv        = partBody.linvel();
    const rel       = strikeVel.sub(new THREE.Vector3(pv.x, pv.y, pv.z));
    const speed     = rel.length();
    if (speed < MIN_HIT_SPEED) return;

    // A heavy swing (strikePower > 1) lands far harder than a normal cut.
    const power = attacker.strikePower ?? 1;
    const dmg = Ragdoll.impactDamage(speed) * power;
    this._hitCd[who] = 0.22;

    const { severed, dead } = victim.applyDamage(part, dmg);

    // Thud of the blade biting flesh — louder for a harder hit.
    audio.hit(dmg / 25);

    // Extra shove along strike direction for drama — heavier on a powerful blow
    rel.normalize().multiplyScalar(dmg * 0.35 * power);
    partBody.applyImpulse({ x: rel.x, y: rel.y, z: rel.z }, true);

    if (victim === this.player) this._screenShake();

    // Right-side feed: every damaging hit logs amount + body part
    this._showDamage(dmg, part, victim === this.player ? 'to-player' : 'to-enemy');

    // Floating combat text right above the struck body part
    const pt = partBody.translation();
    this._flashWorldText(`-${Math.round(dmg)}`,
      new THREE.Vector3(pt.x, pt.y + 0.35, pt.z),
      victim === this.player ? '#ff6b6b' : '#ffe08a');

    if (dead) {
      this._showLabel(who === 'player' ? 'FATAL BLOW!' : 'SLAIN!', '#e74c3c');
    } else if (severed) {
      // Losing a limb ends the bout — fell the victim so the win/lose check fires.
      this._showLabel(`${part.replace(/_/g, ' ').toUpperCase()} SEVERED!`, '#e74c3c');
      if (victim.alive) victim._die();
    }
  }

  _showDamage(dmg, part, cls) {
    const feed = document.getElementById('damage-feed');
    if (!feed) return;
    const el = document.createElement('div');
    el.className = `dmg-entry ${cls}`;
    el.innerHTML =
      `<span class="amt">-${Math.round(dmg)}</span>` +
      `<span class="part">${part.replace(/_/g, ' ').toUpperCase()}</span>`;
    feed.appendChild(el);
    // Cap the feed so it never grows unbounded
    while (feed.childElementCount > 8) feed.firstElementChild.remove();
    requestAnimationFrame(() => {
      setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; }, 1200);
      setTimeout(() => el.remove(), 1900);
    });
  }

  // Two blades meet: shove them apart along the line between them, scaled by
  // how hard they met, and briefly suspend both fighters' sword control so the
  // deflection reads as a real parry rather than being instantly re-aimed.
  _swordClash(a, b) {
    if (!a.swordBody || !b.swordBody) return;
    a.markSwingLanded();          // blades touched — neither swing is a whiff
    b.markSwingLanded();

    const rel = a.swordStrikeVelocity().sub(b.swordStrikeVelocity()).length();
    if (rel < 2.5) return;            // a gentle touch, not a real clash
    if (this._clangCd > 0) return;
    this._clangCd = 0.25;

    audio.clash(rel / 8);             // metallic clang, louder the harder they meet

    // Separation direction (a ← away from b).
    const ta = a.swordBody.translation();
    const tb = b.swordBody.translation();
    let nx = ta.x - tb.x, ny = ta.y - tb.y, nz = ta.z - tb.z;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    // A parry (one side blocking) braces the defender and knocks the attacker
    // wide; an even clash just deflects both.
    const p = Ragdoll.clashResponse(a.parrying, b.parrying);

    // Each blade is knocked back harder the more powerful the OTHER's swing was,
    // so a heavy blow drives the blocking blade well aside.
    const aP = a.strikePower ?? 1, bP = b.strikePower ?? 1;
    const j  = Math.min(7, rel * 0.45);   // deflection impulse, capped
    const up = 0.5;                        // a little lift so the blades kick up
    const ja = j * p.aMul * bP, jb = j * p.bMul * aP;
    a.swordBody.applyImpulse({ x:  nx * ja, y:  ny * ja + up, z:  nz * ja }, true);
    b.swordBody.applyImpulse({ x: -nx * jb, y: -ny * jb + up, z: -nz * jb }, true);

    // A touch of spin so they twist off each other (transverse only, capped).
    deflectSpin(a.swordBody, ja * 0.2);
    deflectSpin(b.swordBody, jb * 0.2);

    // A parried fighter is staggered longer the harder THEY swung — a parried
    // heavy leaves its owner badly overextended.
    a.staggerSword(p.aStag * bP * (p.parry ? Math.max(1, aP * 0.55) : 1));
    b.staggerSword(p.bStag * aP * (p.parry ? Math.max(1, bP * 0.55) : 1));
    if (p.aStam) a.stamina = Math.max(0, a.stamina - p.aStam);
    if (p.bStam) b.stamina = Math.max(0, b.stamina - p.bStam);

    // Flash the clash text at the point where the blades meet
    this._flashWorldText(p.parry ? 'PARRY!' : 'CLANG!',
      new THREE.Vector3((ta.x + tb.x) / 2, (ta.y + tb.y) / 2 + 0.2, (ta.z + tb.z) / 2),
      p.parry ? '#7fd0ff' : '#cfcfcf', 20);
  }

  // A blade caught on a shield: deflect it off the boss and tire the attacker,
  // but deal no damage — the shield ate the blow. A powerful (heavy) swing both
  // rebounds harder off the shield and drives the shield itself back.
  _shieldBlock(attacker, defender) {
    if (!attacker.swordBody || !defender.shieldBody) return;
    attacker.markSwingLanded();   // blade met the shield — not a whiff
    const rel = attacker.swordStrikeVelocity().length();
    if (rel < 2.5) return;            // a gentle touch, not a real strike
    if (this._clangCd > 0) return;
    this._clangCd = 0.25;

    const power = attacker.strikePower ?? 1;
    audio.block(rel / 8 * power);     // dull thunk off the shield, harder if powerful
    const ta = attacker.swordBody.translation();
    const tb = defender.shieldBody.translation();
    let nx = ta.x - tb.x, ny = ta.y - tb.y, nz = ta.z - tb.z;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    const j = Math.min(8, rel * 0.5) * power;   // bounce the blade back off the shield
    attacker.swordBody.applyImpulse({ x: nx * j, y: ny * j + 0.5, z: nz * j }, true);
    deflectSpin(attacker.swordBody, j * 0.3);
    // Drive the shield (and the arm behind it) back along the line of the blow.
    const push = Math.min(7, rel * 0.4) * power;
    defender.shieldBody.applyImpulse({ x: -nx * push, y: -ny * push + 0.3, z: -nz * push }, true);

    // The defender feels the blow THROUGH the shield in proportion to its
    // power: the shield arm tires, and a heavy strike lurches the whole body
    // back behind the shield instead of just flicking the disc.
    defender.stamina = Math.max(0, defender.stamina - 8 * power);
    const lurch = Math.min(6, rel * 0.35) * power * 0.5;
    for (const part of ['torso', 'pelvis']) {
      defender.bodies[part].applyImpulse({ x: -nx * lurch, y: 0, z: -nz * lurch }, true);
    }
    if (defender === this.player && power > 1.5) this._screenShake();

    attacker.staggerSword(0.4 * power);
    attacker.stamina = Math.max(0, attacker.stamina - 16);

    this._flashWorldText(power > 1 ? 'BLOCKED!' : 'BLOCK',
      new THREE.Vector3(tb.x, tb.y + 0.2, tb.z), '#9ad0ff', power > 1 ? 22 : 20);
  }

  // Flash "PARRY" above any fighter the instant it raises a block stance, and
  // "OVERSWUNG!" above one whose heavy swing just whiffed through empty air.
  _announceParries() {
    for (const f of [this.player, this.enemy]) {
      if (f.parrying && !f._parryAnnounced) {
        const pp = f.pelvisPos();
        this._flashWorldText('PARRY', new THREE.Vector3(pp.x, pp.y + 1.0, pp.z), '#7fd0ff', 20);
      }
      f._parryAnnounced = f.parrying;
      if (f.whiffed) {
        f.whiffed = false;
        const pp = f.pelvisPos();
        this._flashWorldText('OVERSWUNG!', new THREE.Vector3(pp.x, pp.y + 1.1, pp.z), '#ff8c2a', 20);
      }
    }
  }

  // Flash short-lived combat text anchored to a 3D world point, projected to
  // screen space; it floats up and fades.
  _flashWorldText(text, worldPos, color = '#fff', size = 16) {
    const cam = this.camera.cam;
    const v = worldPos.clone().project(cam);
    if (v.z > 1) return;                       // behind the camera
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText =
      `position:fixed;left:${x}px;top:${y}px;` +
      'transform:translate(-50%,-50%);' +
      `font-family:Georgia,serif;font-size:${size}px;font-weight:bold;color:${color};` +
      'text-shadow:0 0 6px #000,0 1px 2px #000;pointer-events:none;z-index:30;' +
      'white-space:nowrap;transition:transform 0.7s ease-out,opacity 0.7s;';
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = 'translate(-50%,-50%) translateY(-42px)';
      el.style.opacity   = '0';
    });
    setTimeout(() => el.remove(), 750);
  }

  _showLabel(text, color = '#f0c040') {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText =
      'position:fixed;top:40%;left:50%;transform:translateX(-50%);' +
      `font-family:Georgia,serif;font-size:22px;font-weight:bold;color:${color};` +
      'text-shadow:0 0 10px #000;pointer-events:none;z-index:30;transition:opacity 0.5s;';
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      setTimeout(() => { el.style.opacity = '0'; }, 400);
      setTimeout(() => el.remove(), 950);
    });
  }

  _screenShake() {
    const c = this.renderer.domElement;
    let t = 0;
    const tick = () => {
      t += 16;
      const s = 6 * (1 - t / 200);
      c.style.transform = `translate(${(Math.random()-0.5)*s}px,${(Math.random()-0.5)*s}px)`;
      if (t < 200) requestAnimationFrame(tick);
      else c.style.transform = '';
    };
    tick();
  }

  _updateHUD() {
    this._updateHpBar('player-fill', 'player-hp-text', this.player);
    this._updateHpBar('enemy-fill',  'enemy-hp-text',  this.enemy);
    this._updateStamBar('player-stam', 'player-stam-text', this.player);
    this._updateStamBar('enemy-stam',  'enemy-stam-text',  this.enemy);
    this._updatePartBars(this._partBars.player, this.player);
    this._updatePartBars(this._partBars.enemy,  this.enemy);
  }

  _updateHpBar(fillId, textId, fighter) {
    const frac = fighter.totalHpFraction();
    document.getElementById(fillId).style.width = `${(frac * 100).toFixed(1)}%`;
    document.getElementById(textId).textContent = `HP ${Math.round(frac * 100)}%`;
  }

  _updateStamBar(id, textId, fighter) {
    const frac = fighter.staminaFraction();
    const el = document.getElementById(id);
    el.style.width = `${(frac * 100).toFixed(1)}%`;
    el.classList.toggle('tired', fighter.exhausted);
    document.getElementById(textId).textContent =
      fighter.exhausted ? 'EXHAUSTED' : `STAM ${Math.round(frac * 100)}%`;
  }

  _updatePartBars(bars, fighter) {
    if (!bars) return;
    const health = fighter.partHealth();
    for (let i = 0; i < bars.length; i++) {
      const h = health[i];
      const { fill, label } = bars[i];
      fill.style.width = `${(h.frac * 100).toFixed(0)}%`;
      // Green when healthy, shading to red as the part is worn down.
      fill.style.background = h.detached ? '#444' : `hsl(${(h.frac * 120).toFixed(0)}, 70%, 45%)`;
      label.classList.toggle('severed', h.detached);
    }
  }

  _checkWinLose() {
    if (this._over) return;
    const msg = document.getElementById('message');
    if (!this.player.alive) {
      this._over = true;
      msg.textContent   = this.auto ? 'RED PREVAILS' : 'YOU DIED';
      msg.style.color   = '#e74c3c';
      msg.style.opacity = '1';
      this._onGameOver?.();
    } else if (!this.enemy.alive) {
      this._over = true;
      msg.textContent   = this.auto ? 'GOLD PREVAILS' : 'VICTORY';
      msg.style.color   = '#d4a017';
      msg.style.opacity = '1';
      this._onGameOver?.();
    }
  }
}
