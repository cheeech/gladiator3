import * as THREE from 'three';
import { PhysicsWorld, groups,
         G_WORLD, G_P_BODY, G_P_WPN, G_E_BODY, G_E_WPN } from './physics.js';
import { Ragdoll }           from './ragdoll.js';
import { EnemyAI }           from './ai.js';
import { ThirdPersonCamera } from './camera.js';
import { buildArena }        from './arena.js';

const ENEMY_IDLE     = true;  // test dummy mode — enemy stands but won't fight
const PLAYER_SPEED   = 4.5;
const GUARD_YAW      = 0.30;
const GUARD_PITCH    = 0.25;
const GUARD_REACH    = 0.52;
const WINDUP_REACH   = 0.40;  // sword pulled in close while cocked
const SWING_REACH    = 0.62;
const THRUST_REACH   = 0.85;
const SWING_TIME     = 0.34;  // seconds for the strike sweep
const MIN_HIT_SPEED  = 1.6;   // m/s — slower contacts do no damage

export class Game {
  constructor(RAPIER, input, onGameOver) {
    this.input       = input;
    this._onGameOver = onGameOver;
    this._over       = false;

    this.aimYaw   = GUARD_YAW;
    this.aimPitch = GUARD_PITCH;
    // Attack state machine: guard -> windup (LMB held) -> swing (LMB released)
    this.attack   = { state: 'guard', timer: 0, strike: null, reach: GUARD_REACH, thrust: false };
    this._hitCd   = { player: 0, enemy: 0 };
    this._clangCd = 0;

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
      hasWeapon: !ENEMY_IDLE,   // unarmed training dummy
    });
    this.ai = new EnemyAI(this.enemy, this.player);

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
    document.getElementById('crosshair').style.display = 'block';
    document.getElementById('lock-prompt').style.display = 'none';
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this._loop());
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
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

    this._updateAttack(dt, !!mouse.buttons[0]);

    // ── Player command ─────────────────────────────────────────────────────
    {
      const fwd   = this.camera.forward;
      const right = this.camera.right;
      let mx = 0, mz = 0;
      if (this.input.isDown('KeyW', 'ArrowUp'))    { mx += fwd.x;   mz += fwd.z;   }
      if (this.input.isDown('KeyS', 'ArrowDown'))  { mx -= fwd.x;   mz -= fwd.z;   }
      if (this.input.isDown('KeyA', 'ArrowLeft'))  { mx -= right.x; mz -= right.z; }
      if (this.input.isDown('KeyD', 'ArrowRight')) { mx += right.x; mz += right.z; }
      const len = Math.hypot(mx, mz);
      const vx = len > 0 ? (mx / len) * PLAYER_SPEED : 0;
      const vz = len > 0 ? (mz / len) * PLAYER_SPEED : 0;

      this.player.updateControl(dt, {
        vx, vz,
        targetYaw: this.camera.playerFacing,
        aimYaw:    this.aimYaw,
        aimPitch:  this.aimPitch,
        thrust:    this.attack.thrust,
        reach:     this.attack.reach,
      });
    }

    // ── Enemy command ──────────────────────────────────────────────────────
    if (ENEMY_IDLE) {
      // Stand at guard facing the player — a live physics dummy
      const ep = this.enemy.pelvisPos(), pp = this.player.pelvisPos();
      this.enemy.updateControl(dt, {
        vx: 0, vz: 0,
        targetYaw: Math.atan2(pp.x - ep.x, pp.z - ep.z),
        aimYaw: 0.35, aimPitch: 0.25, thrust: false,
      });
    } else {
      this.enemy.updateControl(dt, this.ai.update(dt));
    }

    // ── Physics + impact damage ───────────────────────────────────────────
    this._hitCd.player = Math.max(0, this._hitCd.player - dt);
    this._hitCd.enemy  = Math.max(0, this._hitCd.enemy  - dt);
    this._clangCd      = Math.max(0, this._clangCd - dt);

    this.physics.step(dt, (m1, m2) => this._onContact(m1, m2));

    this.player.syncMeshes();
    this.enemy.syncMeshes();

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
      if (lmb && this.player.alive) atk.state = 'windup';

    } else if (atk.state === 'windup') {
      // Re-read keys every frame so the path can be adjusted mid-windup
      const pose = this._swingPoses(basePitch).windup;
      const k = Math.min(1, dt * 10);
      this.aimYaw   += (pose.yaw   - this.aimYaw)   * k;
      this.aimPitch += (pose.pitch - this.aimPitch) * k;
      atk.reach += ((pose.reach ?? WINDUP_REACH) - atk.reach) * k;
      if (!lmb) {
        const poses = this._swingPoses(basePitch);
        atk.strike = poses.strike;
        atk.thrust = !!poses.strike.thrust;
        atk.timer  = SWING_TIME;
        atk.state  = 'swing';
      }

    } else if (atk.state === 'swing') {
      const k = Math.min(1, dt * 22);   // fast target = fast blade
      this.aimYaw   += (atk.strike.yaw   - this.aimYaw)   * k;
      this.aimPitch += (atk.strike.pitch - this.aimPitch) * k;
      atk.reach = atk.strike.reach ?? (atk.thrust ? THRUST_REACH : SWING_REACH);
      atk.timer -= dt;
      if (atk.timer <= 0) { atk.state = 'guard'; atk.thrust = false; }
    }
  }

  // Swing path from direction keys. aimYaw: positive = screen-left.
  // A/D = blade travels left/right, W = overhead chop, S = thrust.
  _swingPoses(basePitch) {
    const left     = this.input.isDown('KeyA', 'ArrowLeft');
    const right    = this.input.isDown('KeyD', 'ArrowRight');
    const overhead = this.input.isDown('KeyW', 'ArrowUp');
    const thrust   = this.input.isDown('KeyS', 'ArrowDown');

    // Travel direction: +1 = sweep toward screen-right. Default forehand
    // (winds up on the right, sweeps left) when no key is held.
    let d = 0;
    if (right) d += 1;
    if (left)  d -= 1;

    if (thrust) {
      return {
        windup: { yaw: 0.15, pitch: basePitch + 0.05 },
        strike: { yaw: 0.00, pitch: basePitch, thrust: true },
      };
    }
    if (overhead) {
      return {
        windup: { yaw: 0.35 * d + 0.1, pitch: basePitch + 1.15 },
        strike: { yaw: -0.90 * d,      pitch: basePitch - 0.55 },
      };
    }
    if (d === 0) {
      // No direction held: pendulum backswing — pitch beyond vertical sends
      // the grip target up and behind the head, so the hand raises overhead
      // with the blade cocked back. Release whips it down into a stab.
      return {
        windup: { yaw: 0.05, pitch: basePitch + 1.85, reach: 0.50 },
        strike: { yaw: 0.00, pitch: basePitch - 0.85, reach: THRUST_REACH, thrust: true },
      };
    }
    return {
      windup: { yaw:  1.5 * d, pitch: basePitch + 0.55 },
      strike: { yaw: -1.3 * d, pitch: basePitch - 0.10 },
    };
  }

  _onContact(m1, m2) {
    // weapon vs weapon → parry clang
    if (m1.kind === 'weapon' && m2.kind === 'weapon') {
      if (this._clangCd <= 0) {
        const s = m1.ref.swordStrikeVelocity().length();
        if (s > 2.5) {
          this._showLabel('CLANG!', '#cfcfcf');
          this._clangCd = 0.4;
        }
      }
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

    const who = attacker === this.player ? 'player' : 'enemy';
    if (this._hitCd[who] > 0) return;

    const strikeVel = attacker.swordStrikeVelocity();
    const partBody  = victim.bodies[part];
    const pv        = partBody.linvel();
    const rel       = strikeVel.sub(new THREE.Vector3(pv.x, pv.y, pv.z));
    const speed     = rel.length();
    if (speed < MIN_HIT_SPEED) return;

    const dmg = Math.min(60, (speed - 1.2) * 11);
    this._hitCd[who] = 0.22;

    const { severed, dead } = victim.applyDamage(part, dmg);

    // Extra shove along strike direction for drama
    rel.normalize().multiplyScalar(dmg * 0.35);
    partBody.applyImpulse({ x: rel.x, y: rel.y, z: rel.z }, true);

    if (victim === this.player) this._screenShake();

    if (dead) {
      this._showLabel(who === 'player' ? 'FATAL BLOW!' : 'SLAIN!', '#e74c3c');
    } else if (severed) {
      this._showLabel(`${part.replace(/_/g, ' ').toUpperCase()} SEVERED!`, '#e74c3c');
    } else if (who === 'player') {
      this._showLabel(`${Math.round(dmg)}`, '#f0c040');
    }
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
    document.getElementById('player-fill').style.width =
      `${(this.player.totalHpFraction() * 100).toFixed(1)}%`;
    document.getElementById('enemy-fill').style.width =
      `${(this.enemy.totalHpFraction() * 100).toFixed(1)}%`;
  }

  _checkWinLose() {
    if (this._over) return;
    const msg = document.getElementById('message');
    if (!this.player.alive) {
      this._over = true;
      msg.textContent   = 'YOU DIED';
      msg.style.color   = '#e74c3c';
      msg.style.opacity = '1';
      this._onGameOver?.();
    } else if (!this.enemy.alive) {
      this._over = true;
      msg.textContent   = 'VICTORY';
      msg.style.color   = '#d4a017';
      msg.style.opacity = '1';
      this._onGameOver?.();
    }
  }
}
