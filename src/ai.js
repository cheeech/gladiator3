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

export class EnemyAI {
  constructor(enemy, player, { sparring = false } = {}) {
    this.enemy    = enemy;
    this.player   = player;
    this.sparring = sparring;   // less forward pressure, swing on a timer
    this.state  = 'APPROACH';
    this.timer  = 0;
    this.style  = null;
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

    const e = this.enemy.pelvisPos();
    const p = this.player.pelvisPos();
    const dx = p.x - e.x, dz = p.z - e.z;
    const dist = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(dx, dz);
    const ux = dist > 0.01 ? dx / dist : 0;       // toward foe
    const uz = dist > 0.01 ? dz / dist : 0;
    const px = -uz, pz = ux;                       // perpendicular (strafe)

    let vx = 0, vz = 0, thrust = false;

    if (!this.enemy.alive || this.enemy.knocked) {
      this.state = 'RECOVER';
      this.timer = 0.8;
      return { vx: 0, vz: 0, targetYaw, aimYaw: this.aimYaw, aimPitch: this.aimPitch, thrust: false };
    }

    // Always look for a chance to dash clear of an incoming blade.
    this._maybeDodge(ux, uz, px, pz, dist);

    switch (this.state) {
      case 'APPROACH': {
        // Circle and bob at striking range instead of standing at guard.
        ({ vx, vz } = this._circleStep(ux, uz, px, pz, ENGAGE_DIST, dist, 1));
        this._aimToward(GUARD, dt, 4);
        if ((this.sparring ? this.timer <= 0 : dist < 1.9) && this.player.alive) {
          this.style = this._pickStyle();
          this.state = 'WINDUP';
          this.timer = 0.30 + Math.random() * 0.20;
        }
        break;
      }

      case 'WINDUP':
        // Plant somewhat and step into range, but keep a little lateral motion.
        ({ vx, vz } = this._circleStep(ux, uz, px, pz, ENGAGE_DIST * 0.85, dist, 0.35));
        this._aimToward(this.style.windup, dt, 9);
        if (this.timer <= 0) { this.state = 'SWING'; this.timer = 0.26; }
        break;

      case 'SWING':
        // Commit forward into the cut so the blade actually reaches.
        ({ vx, vz } = this._circleStep(ux, uz, px, pz, ENGAGE_DIST * 0.6, dist, 0.1));
        vx += ux * 0.9; vz += uz * 0.9;
        this._aimToward(this.style.strike, dt, 22);  // fast = high blade speed
        thrust = !!this.style.thrust;
        if (this.style.thrust) { vx += ux * 1.4; vz += uz * 1.4; }
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
    }

    return { vx, vz, targetYaw, aimYaw: this.aimYaw, aimPitch: this.aimPitch, thrust };
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

  // Dash clear of an incoming strike — but decide only ONCE per strike (with a
  // chance to misread it), so a steady stream of attacks isn't perfectly negated.
  _maybeDodge(ux, uz, px, pz, dist) {
    const blade = this.player.swordStrikeVelocity
      ? this.player.swordStrikeVelocity().length() : 0;
    const threatened = this.state !== 'SWING' && dist <= DODGE_RANGE && blade >= DODGE_BLADE_SPEED;
    if (!threatened) { this._threatPrimed = false; return; }   // strike over → re-arm
    if (this._threatPrimed) return;                            // already reacted to this one
    this._threatPrimed = true;
    if (Math.random() > DODGE_CHANCE) return;                  // sometimes you don't react in time
    // Sidestep along the circle with a touch of backpedal.
    if (this.enemy.tryDodge(px * this.circleDir - ux * 0.3, pz * this.circleDir - uz * 0.3)) {
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
