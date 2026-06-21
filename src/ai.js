// Enemy controller — outputs the same cmd shape the player produces.
// Swings are physical: the AI moves its sword aim target fast and the
// PD controller in the ragdoll does the actual swinging.

const SWING_STYLES = [
  { name: 'cut_r',    windup: { yaw: -1.4, pitch:  0.45 }, strike: { yaw:  1.2, pitch:  0.0  } },
  { name: 'cut_l',    windup: { yaw:  1.4, pitch:  0.45 }, strike: { yaw: -1.2, pitch:  0.0  } },
  { name: 'overhead', windup: { yaw:  0.1, pitch:  1.25 }, strike: { yaw:  0.0, pitch: -0.55 } },
  { name: 'thrust',   windup: { yaw:  0.0, pitch:  0.15 }, strike: { yaw:  0.0, pitch:  0.10 }, thrust: true },
  { name: 'low_r',    windup: { yaw: -1.3, pitch: -0.20 }, strike: { yaw:  1.1, pitch: -0.85 } },
  { name: 'low_l',    windup: { yaw:  1.3, pitch: -0.20 }, strike: { yaw: -1.1, pitch: -0.85 } },
];

const GUARD = { yaw: 0.35, pitch: 0.25 };
// Block stances: a spectrum of guards the AI throws when parrying — centred
// high, swept out to either side, dropped low, or raised overhead — so blocks
// read as a real, varied defence rather than one canned pose.
const PARRY_POSES = [
  { yaw:  0.00, pitch:  0.70 },   // centred high guard
  { yaw:  1.15, pitch:  0.15 },   // sweep to one side
  { yaw: -1.15, pitch:  0.15 },   // sweep to the other side
  { yaw:  0.10, pitch: -0.60 },   // low block, blade swept down
  { yaw:  0.20, pitch:  1.20 },   // high block raised overhead
];

// Footwork — a real fighter never stands still: circle the foe, bob in and out,
// keep distance, and dash clear of incoming blades.
const ENGAGE_DIST       = 1.5;   // preferred striking distance
const BACKOFF_DIST      = 2.1;   // distance to drift to between attacks
const STRAFE_SPEED      = 1.2;   // lateral circling speed
const BOB_AMP           = 0.6;   // in/out bob amplitude (m/s)
const BOB_FREQ          = 4.5;   // bob rate (rad/s)
const DODGE_BLADE_SPEED = 9;     // opponent blade speed that triggers an evade
const DODGE_RANGE       = 2.0;   // only dash if the foe is this close
const DODGE_CHANCE      = 0.4;   // chance to react to any given incoming strike
const PARRY_CHANCE      = 0.45;  // of reactions, the share that block instead of dash
const PARRY_HOLD        = 0.45;  // s to hold the block stance
// Heavy swing: occasionally the AI loads a big committed blow — longer windup,
// a much wider arc, extra reach and stamina, far more damage, and a harder
// knock-back when blocked. Mirrors the player's charged heavy attack.
const HEAVY_CHANCE      = 0.30;  // share of swings that are heavy
const HEAVY_POWER       = 2.2;   // damage / knockback multiplier (matches game.js)
const HEAVY_STAM_COST   = 32;    // stamina committed to a heavy swing
const HEAVY_SWING_REACH = 0.98;  // arm extends much further on the heavy strike
const HEAVY_YAW_MUL     = 1.6;   // widens the swing arc
// Periodic ducking — every so often the fighter drops into a crouch for a beat,
// so an AI-vs-AI bout (watch mode) shows the full vertical range of movement.
const DUCK_PERIOD_MIN   = 2.2;   // s between ducks
const DUCK_PERIOD_MAX   = 4.5;
const DUCK_HOLD         = 0.55;  // s held down each duck
const DUCK_STRAFE       = 3.2;   // lateral lunge speed during a duck (weave aside)

export class EnemyAI {
  constructor(enemy, player, { sparring = false } = {}) {
    this.enemy    = enemy;
    this.player   = player;
    this.sparring = sparring;   // less forward pressure, swing on a timer
    this.state  = 'APPROACH';
    this.timer  = 0;
    this.style  = null;
    this.heavy  = false;               // true while loading/landing a heavy swing
    this.parryPose = PARRY_POSES[0];   // chosen fresh on each block
    this.duck      = 0;                // smoothed crouch amount (0..1)
    this.ducking   = false;
    this.duckDir   = 1;                // which way the current duck weaves (±1)
    this.duckTimer = DUCK_PERIOD_MIN + Math.random() * (DUCK_PERIOD_MAX - DUCK_PERIOD_MIN);
    this.aimYaw   = GUARD.yaw;
    this.aimPitch = GUARD.pitch;
    this.speed    = 1.5 + Math.random() * 0.5;
    this.aggression = 0.7 + Math.random() * 0.5;
    this.clock        = Math.random() * 10;            // desync bob phase
    this.circleDir    = Math.random() < 0.5 ? -1 : 1;  // strafe direction
    this.circleTimer  = 0.6 + Math.random() * 1.2;     // until next juke
    this._threatPrimed = false;                        // one dodge decision per incoming strike
  }

  // Returns cmd { vx, vz, targetYaw, aimYaw, aimPitch, thrust }
  update(dt) {
    this.timer       -= dt;
    this.clock       += dt;
    this.circleTimer -= dt;
    if (this.circleTimer <= 0) {   // periodically reverse the circle (juke)
      this.circleDir   = -this.circleDir;
      this.circleTimer = 0.6 + Math.random() * 1.4;
    }

    // Periodic duck cycle: drop into a crouch for a beat — weaving to one side —
    // then rise and wait.
    this.duckTimer -= dt;
    if (this.duckTimer <= 0) {
      this.ducking = !this.ducking;
      if (this.ducking) this.duckDir = Math.random() < 0.5 ? -1 : 1;  // weave left/right
      this.duckTimer = this.ducking
        ? DUCK_HOLD
        : DUCK_PERIOD_MIN + Math.random() * (DUCK_PERIOD_MAX - DUCK_PERIOD_MIN);
    }

    const e = this.enemy.pelvisPos();
    const p = this.player.pelvisPos();
    const dx = p.x - e.x, dz = p.z - e.z;
    const dist = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(dx, dz);
    const ux = dist > 0.01 ? dx / dist : 0;       // toward foe
    const uz = dist > 0.01 ? dz / dist : 0;
    const px = -uz, pz = ux;                       // perpendicular (strafe)

    let vx = 0, vz = 0, thrust = false, power = 1, reach;

    // Block stance is only on while actively parrying this frame.
    this.enemy.parrying = false;

    if (!this.enemy.alive || this.enemy.knocked) {
      this.state = 'RECOVER';
      this.timer = 0.8;
      return { vx: 0, vz: 0, targetYaw, aimYaw: this.aimYaw, aimPitch: this.aimPitch, thrust: false };
    }

    // Always look for a chance to defend against an incoming blade — dash clear
    // or raise a block.
    this._maybeDefend(ux, uz, px, pz, dist);

    switch (this.state) {
      case 'APPROACH': {
        // Circle and bob at striking range instead of standing at guard.
        ({ vx, vz } = this._circleStep(ux, uz, px, pz, ENGAGE_DIST, dist, 1));
        this._aimToward(GUARD, dt, 4);
        if ((this.sparring ? this.timer <= 0 : dist < 1.9) && this.player.alive) {
          this.style = this._pickStyle();
          // Sometimes commit to a heavy swing (if there's stamina to spend).
          this.heavy = Math.random() < HEAVY_CHANCE && this.enemy.stamina > HEAVY_STAM_COST;
          this.state = 'WINDUP';
          this.timer = (this.heavy ? 0.5 : 0.30) + Math.random() * 0.20;
        }
        break;
      }

      case 'WINDUP':
        // Plant somewhat and step into range, but keep a little lateral motion.
        ({ vx, vz } = this._circleStep(ux, uz, px, pz, ENGAGE_DIST * 0.85, dist, 0.35));
        this._aimToward(this._heavyize(this.style.windup), dt, 9);
        if (this.timer <= 0) {
          this.state = 'SWING';
          this.timer = this.heavy ? 0.34 : 0.26;
          if (this.heavy) this.enemy.stamina = Math.max(0, this.enemy.stamina - HEAVY_STAM_COST);
        }
        break;

      case 'SWING':
        // Commit forward into the cut so the blade actually reaches — harder on
        // a heavy swing.
        ({ vx, vz } = this._circleStep(ux, uz, px, pz, ENGAGE_DIST * 0.6, dist, 0.1));
        vx += ux * (this.heavy ? 1.4 : 0.9); vz += uz * (this.heavy ? 1.4 : 0.9);
        this._aimToward(this._heavyize(this.style.strike), dt, 22);  // fast = high blade speed
        thrust = !!this.style.thrust;
        if (this.style.thrust) { vx += ux * 1.4; vz += uz * 1.4; }
        if (this.heavy) { power = HEAVY_POWER; reach = HEAVY_SWING_REACH; }
        if (this.timer <= 0) {
          this.state = 'RECOVER';
          this.timer = (0.7 + Math.random() * 0.6) / this.aggression;
        }
        break;

      case 'RECOVER':
        // Break off and circle out, then re-engage.
        ({ vx, vz } = this._circleStep(ux, uz, px, pz, BACKOFF_DIST, dist, 1));
        this._aimToward(GUARD, dt, 5);
        if (this.timer <= 0) {
          this.state = 'APPROACH';
          if (this.sparring) this.timer = 0.5 + Math.random() * 1.5;  // pause between swings
        }
        break;

      case 'PARRY':
        // Stand mostly firm and raise the blade to block the incoming cut,
        // throwing it toward the (randomly chosen) guard for this block.
        ({ vx, vz } = this._circleStep(ux, uz, px, pz, ENGAGE_DIST, dist, 0.2));
        this._aimToward(this.parryPose, dt, 12);
        this.enemy.parrying = true;
        if (this.timer <= 0) { this.state = 'APPROACH'; this.timer = 0; }
        break;
    }

    // Ease the crouch toward its target — but never duck mid-swing, so attacks
    // keep their reach.
    const duckTarget = (this.ducking && this.state !== 'WINDUP' && this.state !== 'SWING') ? 1 : 0;
    this.duck += (duckTarget - this.duck) * Math.min(1, dt * 9);
    // Weave hard to the side as he drops, so the duck travels horizontally too.
    vx += px * this.duckDir * DUCK_STRAFE * this.duck;
    vz += pz * this.duckDir * DUCK_STRAFE * this.duck;

    return { vx, vz, targetYaw, aimYaw: this.aimYaw, aimPitch: this.aimPitch,
             thrust, power, reach, crouch: this.duck };
  }

  // Widen a swing pose's arc when the current swing is heavy.
  _heavyize(pose) {
    if (!this.heavy) return pose;
    return { yaw: pose.yaw * HEAVY_YAW_MUL, pitch: pose.pitch };
  }

  // Footwork velocity: keep `desired` distance (move in/out), circle sideways,
  // and bob constantly. strafeScale dials lateral motion down while attacking.
  _circleStep(ux, uz, px, pz, desired, dist, strafeScale) {
    let radial = (dist - desired) * 1.6;
    radial = Math.max(-1.6, Math.min(1.8, radial));
    const bob    = Math.sin(this.clock * BOB_FREQ) * BOB_AMP;
    const strafe = this.circleDir * STRAFE_SPEED * strafeScale;
    return {
      vx: ux * (radial + bob) + px * strafe,
      vz: uz * (radial + bob) + pz * strafe,
    };
  }

  // React to an incoming strike — either dash clear or raise a block — but
  // decide only ONCE per strike (with a chance to misread it), so a steady
  // stream of attacks isn't perfectly negated.
  _maybeDefend(ux, uz, px, pz, dist) {
    const blade = this.player.swordStrikeVelocity
      ? this.player.swordStrikeVelocity().length() : 0;
    const reacting = this.state !== 'SWING' && this.state !== 'PARRY';
    const threatened = reacting && dist <= DODGE_RANGE && blade >= DODGE_BLADE_SPEED;
    if (!threatened) { this._threatPrimed = false; return; }   // strike over → re-arm
    if (this._threatPrimed) return;                            // already reacted to this one
    this._threatPrimed = true;
    if (Math.random() > DODGE_CHANCE) return;                  // sometimes you don't react in time
    // Block if the foe is right on top of us (no room to dash), otherwise pick
    // between a block and a sidestep.
    if (Math.random() < PARRY_CHANCE) {
      this.state = 'PARRY';
      this.timer = PARRY_HOLD;
      this.parryPose = PARRY_POSES[Math.floor(Math.random() * PARRY_POSES.length)];
    } else if (this.enemy.tryDodge(px * this.circleDir - ux * 0.3, pz * this.circleDir - uz * 0.3)) {
      this.circleTimer = 0.6 + Math.random() * 1.0;            // keep juking after the dash
    }
  }

  // Against a downed/crawling foe, mostly swing low to actually connect.
  _pickStyle() {
    const lowStyles = SWING_STYLES.filter(s => s.name.startsWith('low_'));
    if (this.player.downed && Math.random() < 0.8) {
      return lowStyles[Math.floor(Math.random() * lowStyles.length)];
    }
    return SWING_STYLES[Math.floor(Math.random() * SWING_STYLES.length)];
  }

  _aimToward(target, dt, rate) {
    const k = Math.min(1, dt * rate);
    this.aimYaw   += (target.yaw   - this.aimYaw)   * k;
    this.aimPitch += (target.pitch - this.aimPitch) * k;
  }
}
