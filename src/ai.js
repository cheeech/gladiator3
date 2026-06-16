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

export class EnemyAI {
  constructor(enemy, player) {
    this.enemy  = enemy;
    this.player = player;
    this.state  = 'APPROACH';
    this.timer  = 0;
    this.style  = null;
    this.aimYaw   = GUARD.yaw;
    this.aimPitch = GUARD.pitch;
    this.speed    = 1.5 + Math.random() * 0.5;
    this.aggression = 0.7 + Math.random() * 0.5;
  }

  // Returns cmd { vx, vz, targetYaw, aimYaw, aimPitch, thrust }
  update(dt) {
    const e = this.enemy.pelvisPos();
    const p = this.player.pelvisPos();
    const dx = p.x - e.x, dz = p.z - e.z;
    const dist = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(dx, dz);
    const dirX = dist > 0.01 ? dx / dist : 0;
    const dirZ = dist > 0.01 ? dz / dist : 0;

    let vx = 0, vz = 0, thrust = false;
    this.timer -= dt;

    if (!this.enemy.alive || this.enemy.knocked) {
      this.state = 'RECOVER';
      this.timer = 0.8;
      return { vx: 0, vz: 0, targetYaw, aimYaw: this.aimYaw, aimPitch: this.aimPitch, thrust: false };
    }

    switch (this.state) {
      case 'APPROACH':
        if (dist > 1.7) {
          vx = dirX * this.speed;
          vz = dirZ * this.speed;
        }
        this._aimToward(GUARD, dt, 4);
        if (dist < 1.9 && this.player.alive) {
          this.style = this._pickStyle();
          this.state = 'WINDUP';
          this.timer = 0.30 + Math.random() * 0.20;
        }
        break;

      case 'WINDUP':
        this._aimToward(this.style.windup, dt, 9);
        vx = dirX * 0.4; vz = dirZ * 0.4;
        if (this.timer <= 0) {
          this.state = 'SWING';
          this.timer = 0.26;
        }
        break;

      case 'SWING':
        this._aimToward(this.style.strike, dt, 22);  // fast = high blade speed
        thrust = !!this.style.thrust;
        if (this.style.thrust) { vx = dirX * 1.8; vz = dirZ * 1.8; }
        if (this.timer <= 0) {
          this.state = 'RECOVER';
          this.timer = (0.7 + Math.random() * 0.6) / this.aggression;
        }
        break;

      case 'RECOVER':
        this._aimToward(GUARD, dt, 5);
        if (dist < 1.0) { vx = -dirX * 1.2; vz = -dirZ * 1.2; }  // back off
        if (this.timer <= 0) this.state = 'APPROACH';
        break;
    }

    return { vx, vz, targetYaw, aimYaw: this.aimYaw, aimPitch: this.aimPitch, thrust };
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
