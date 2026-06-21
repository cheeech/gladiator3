import * as THREE from 'three';

// Rest pose: world positions with feet at y=0, facing +Z.
// half = collider half-extents. All metres / kg.
const PARTS = {
  pelvis:      { half: [0.16, 0.10, 0.12], pos: [ 0.00, 1.00, 0], mass: 7,   hp: 75 },
  torso:       { half: [0.17, 0.22, 0.12], pos: [ 0.00, 1.32, 0], mass: 14,  hp: 95 },
  head:        { half: [0.10, 0.12, 0.10], pos: [ 0.00, 1.72, 0], mass: 4,   hp: 45 },
  upper_arm_l: { half: [0.06, 0.14, 0.06], pos: [ 0.30, 1.32, 0], mass: 2,   hp: 25 },
  upper_arm_r: { half: [0.06, 0.14, 0.06], pos: [-0.30, 1.32, 0], mass: 2,   hp: 25 },
  lower_arm_l: { half: [0.05, 0.13, 0.05], pos: [ 0.30, 1.05, 0], mass: 1.5, hp: 20 },
  lower_arm_r: { half: [0.05, 0.13, 0.05], pos: [-0.30, 1.05, 0], mass: 1.5, hp: 20 },
  upper_leg_l: { half: [0.08, 0.18, 0.08], pos: [ 0.10, 0.72, 0], mass: 5,   hp: 35 },
  upper_leg_r: { half: [0.08, 0.18, 0.08], pos: [-0.10, 0.72, 0], mass: 5,   hp: 35 },
  lower_leg_l: { half: [0.07, 0.20, 0.07], pos: [ 0.10, 0.34, 0], mass: 3,   hp: 25 },
  lower_leg_r: { half: [0.07, 0.20, 0.07], pos: [-0.10, 0.34, 0], mass: 3,   hp: 25 },
};

// [parent, child, world anchor at rest]
const JOINTS = [
  ['pelvis',      'torso',       [ 0.00, 1.10, 0]],
  ['torso',       'head',        [ 0.00, 1.58, 0]],
  ['torso',       'upper_arm_l', [ 0.30, 1.46, 0]],
  ['torso',       'upper_arm_r', [-0.30, 1.46, 0]],
  ['upper_arm_l', 'lower_arm_l', [ 0.30, 1.18, 0]],
  ['upper_arm_r', 'lower_arm_r', [-0.30, 1.18, 0]],
  ['pelvis',      'upper_leg_l', [ 0.10, 0.90, 0]],
  ['pelvis',      'upper_leg_r', [-0.10, 0.90, 0]],
  ['upper_leg_l', 'lower_leg_l', [ 0.10, 0.54, 0]],
  ['upper_leg_r', 'lower_leg_r', [-0.10, 0.54, 0]],
];

const VITAL = new Set(['pelvis', 'torso', 'head']);
const MAX_TOTAL_HP = Object.values(PARTS).reduce((s, p) => s + p.hp, 0);

// A limb only comes off after absorbing far more than its base HP — dismemberment
// is sustained punishment, not one lucky cut. Total damage to sever a non-vital
// part = hp * SEVER_MARGIN, but never less than SEVER_FLOOR (a single max hit = 60),
// so no limb can ever be severed by one blow.
const SEVER_MARGIN = 2.5;
const SEVER_FLOOR  = 75;

// Impact damage from a blade contact. Lower DAMAGE_SCALE → less damage per hit
// → longer fights. (MIN_HIT_SPEED in game.js still gates out gentle taps.)
const DAMAGE_SCALE = 0.42;
const DAMAGE_CAP   = 60;

// Stamina: a heavy sword tires the arm. Swinging it fast and holding it raised
// both drain stamina; lowering it and resting recovers. When it bottoms out the
// fighter is exhausted and the blade droops until stamina climbs back up.
const MAX_STAMINA      = 100;
const STAM_SWING_COST  = 2.2;   // per (m/s of blade speed above the floor)·s
const STAM_HOLD_COST   = 26;    // per (radian the blade is raised)·s
const STAM_REGEN       = 18;    // per s while resting
const STAM_SWING_FLOOR = 3;     // m/s below which a moving blade is "not swinging"
const STAM_EXHAUST_AT  = 1;     // drop to here → exhausted
const STAM_RECOVER_AT  = 35;    // must climb back to here to lift the blade again
const STAM_DROOP_PITCH = -0.7;  // forced blade pitch while exhausted (points down)
const STAM_TIRED_AUTH  = 0.4;   // sword controller authority while exhausted

// Dodge: a quick whole-body evasive burst. Costs stamina and has a cooldown.
const DODGE_SPEED = 6.5;   // m/s added to the whole body in the dodge direction
const DODGE_COST  = 30;    // stamina per dodge
const DODGE_CD    = 0.7;   // s between dodges

// Parry: a well-timed block deflects the attacker's blade hard and tires them.
const PARRY_STAM_HIT = 22;  // stamina the attacker loses on a parried blow

// Controller gains
const LEVITATE_KP   = 1200;
const LEVITATE_KD   = 130;
const LEVITATE_MAX  = 1100;
const UPRIGHT_KP    = 260;
const UPRIGHT_KD    = 24;
const UPRIGHT_MAX   = 210;
const YAW_KP        = 16;
const YAW_KD        = 3;
const YAW_MAX       = 22;
const MOVE_KP       = 180;
const MOVE_MAX      = 380;
const SWORD_KP      = 750;
const SWORD_KD      = 38;
const SWORD_MAX_F   = 320;
const SWORD_T_KP    = 24;
const SWORD_T_KD    = 2;
const SWORD_T_MAX   = 40;

// Shield controller — holds the left-hand shield up in a guard in front of the
// chest, face toward the foe. Softer than the sword so it gives a little.
const SHIELD_KP     = 190;
const SHIELD_KD     = 32;
const SHIELD_MAX_F  = 140;
const SHIELD_T_KP   = 16;
const SHIELD_T_KD   = 3;
const SHIELD_T_MAX  = 28;

const KNOCK_THRESHOLD = 40;
const PELVIS_TARGET_H = 1.0;
// Ducking: a crouch command (cmd.crouch 0..1) drops the whole body's target
// heights, widening the avatar's vertical range. Combined with lateral movement
// it lets him duck down toward the lower left/right.
const DUCK_DROP       = 0.48;  // metres the body sinks at full crouch

// Prone crawl after a leg is lost — dragging yourself is slow and clumsy.
const CRAWL_SPEED = 1.2;   // m/s
const CRAWL_KP    = 70;
const CRAWL_MAX   = 130;
const CRAWL_CHEST_H = 0.55; // torso centre height when propped on the ground

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q  = new THREE.Quaternion();

function rotY([x, y, z], angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: x * c + z * s, y, z: -x * s + z * c };
}

function clampVec(v, max) {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len > max) { const k = max / len; v.x *= k; v.y *= k; v.z *= k; }
  return v;
}

export class Ragdoll {
  constructor(scene, physics, {
    x = 0, z = 0, facing = 0,
    bodyColor = 0xb08040, helmetColor = 0x888888,
    bodyGroups, weaponGroups, hasWeapon = true, hasShield = true,
  }) {
    this.scene    = scene;
    this.physics  = physics;
    this.facing   = facing;
    this.alive    = true;
    this.hp       = {};
    this.detached = new Set();
    this.bodies   = {};
    this.meshes   = {};
    this.joints   = {};      // part -> joint connecting it to its parent
    this.knockTimer = 0;
    this.impactAccum = 0;
    this.downed       = false;  // true once a leg is severed — can no longer stand
    this.swordStagger = 0;      // brief loss of sword control after a clash
    this.stamina      = MAX_STAMINA;
    this.exhausted    = false;  // out of stamina → blade droops until recovered
    this.dodgeCd      = 0;      // cooldown before the next dodge
    this.parrying     = false;  // holding a block stance this frame
    this.strikePower  = 1;      // >1 while swinging a heavy blow (set via cmd.power)
    this._inertia   = {};   // per-part approximate angular inertia

    this._hasWeapon = hasWeapon;
    this._hasShield = hasShield;
    this._spawnQuat = { x: 0, y: Math.sin(facing / 2), z: 0, w: Math.cos(facing / 2) };
    this._build(x, z, bodyColor, helmetColor, bodyGroups, weaponGroups);
  }

  _build(x, z, bodyColor, helmetColor, bodyGroups, weaponGroups) {
    const bodyMat   = new THREE.MeshStandardMaterial({ color: bodyColor,   roughness: 0.75, metalness: 0.05 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: helmetColor, roughness: 0.4,  metalness: 0.6  });

    for (const [name, def] of Object.entries(PARTS)) {
      this.hp[name] = def.hp;

      const wp = rotY(def.pos, this.facing);
      const isLeg  = name.includes('leg');
      const isLimb = isLeg || name.includes('arm');
      const { body, collider } = this.physics.createDynamicBox({
        pos:  { x: x + wp.x, y: wp.y, z: z + wp.z },
        rot:  this._spawnQuat,
        half: { x: def.half[0], y: def.half[1], z: def.half[2] },
        mass: def.mass,
        linDamp: isLimb ? 0.6 : 0.15,
        // Pelvis: built-in (implicit, always stable) damping does what the
        // gain-clamped explicit controller can't — kills residual wobble.
        angDamp: isLeg ? 3.5 : (isLimb || name === 'head') ? 2.5 :
                 name === 'pelvis' ? 4.0 : 1.2,
        collisionGroups: bodyGroups,
      });
      this.bodies[name] = body;
      this.physics.tag(collider, { ref: this, kind: 'part', part: name });

      // Mean box inertia — used to clamp angular PD gains per body
      const dx = def.half[0]*2, dy = def.half[1]*2, dz = def.half[2]*2;
      this._inertia[name] = (def.mass / 12) *
        ((dy*dy + dz*dz) + (dx*dx + dz*dz) + (dx*dx + dy*dy)) / 3;

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(def.half[0] * 2, def.half[1] * 2, def.half[2] * 2),
        (name === 'head' ? helmetMat : bodyMat).clone()
      );
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.meshes[name] = mesh;
    }

    for (const [parent, child, anchor] of JOINTS) {
      const pa = PARTS[parent].pos, ca = PARTS[child].pos;
      const joint = this.physics.sphericalJoint(
        this.bodies[parent], this.bodies[child],
        { x: anchor[0] - pa[0], y: anchor[1] - pa[1], z: anchor[2] - pa[2] },
        { x: anchor[0] - ca[0], y: anchor[1] - ca[1], z: anchor[2] - ca[2] },
      );
      this.joints[child] = joint;
    }

    if (this._hasWeapon) this._buildSword(x, z, weaponGroups);
    if (this._hasShield) this._buildShield(x, z, weaponGroups);
  }

  _buildSword(x, z, weaponGroups) {
    // Grip at body origin, blade extends +Z. Spawn at the right hand.
    const hand = rotY([-0.30, 0.92, 0.06], this.facing);
    const { body, collider } = this.physics.createDynamicBox({
      pos:  { x: x + hand.x, y: hand.y, z: z + hand.z },
      rot:  this._spawnQuat,
      half: { x: 0.02, y: 0.02, z: 0.40 },
      mass: 1.3,
      linDamp: 0.2,
      angDamp: 1.5,
      restitution: 0.25,   // blades bounce off each other on a clash
      ccd: true,           // don't tunnel through the other blade mid-swing
      collisionGroups: weaponGroups,
    });
    // The collider cuboid is centred on the body; we want grip at origin so
    // re-create offset via a second collider is overkill — instead the joint
    // anchor below treats local (0,0,-0.40) as the grip.
    this.swordBody = body;
    this.physics.tag(collider, { ref: this, kind: 'weapon' });

    // Joint: right hand (bottom of lower_arm_r) to sword grip end
    this.swordJoint = this.physics.sphericalJoint(
      this.bodies['lower_arm_r'], this.swordBody,
      { x: 0, y: -0.13, z: 0 },
      { x: 0, y: 0, z: -0.40 },
    );

    // Visuals — group origin at body centre, blade along +Z
    const g = new THREE.Group();
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.035, 0.78),
      new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.95, roughness: 0.08 })
    );
    blade.position.z = 0.02;
    blade.castShadow = true;
    g.add(blade);
    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.17, 0.03, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x996600, metalness: 0.8, roughness: 0.3 })
    );
    guard.position.z = -0.37;
    g.add(guard);
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.03, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x4a2800, roughness: 0.9 })
    );
    grip.position.z = -0.45;
    g.add(grip);
    this.scene.add(g);
    this.swordMesh = g;
  }

  _buildShield(x, z, shieldGroups) {
    // A round shield strapped to the left forearm. Face normal is local +Z.
    // Spawn it raised in front of the chest where the controller will hold it.
    const R = 0.26, TH = 0.045;
    const spawn = rotY([0.30, 1.42, 0.40], this.facing);
    const { body, collider } = this.physics.createDynamicBox({
      pos:  { x: x + spawn.x, y: spawn.y, z: z + spawn.z },
      rot:  this._spawnQuat,
      half: { x: R, y: R, z: TH },
      mass: 0.9,           // light prop so it doesn't overload the slim forearm
      linDamp: 0.5,
      angDamp: 2.5,
      friction: 0.2,       // slides freely if it ever drags on the ground
      restitution: 0.1,
      collisionGroups: shieldGroups,
    });
    this.shieldBody = body;
    this.physics.tag(collider, { ref: this, kind: 'shield' });

    // Strap: left hand (bottom of lower_arm_l) to the shield's inner face.
    this.shieldJoint = this.physics.sphericalJoint(
      this.bodies['lower_arm_l'], this.shieldBody,
      { x: 0, y: -0.13, z: 0 },
      { x: 0, y: 0, z: -TH },
    );

    // Visuals: a slightly domed disc with a rim and a central boss.
    const g = new THREE.Group();
    const faceMat = new THREE.MeshStandardMaterial({ color: 0x7a5a2a, metalness: 0.4, roughness: 0.5 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, metalness: 0.9, roughness: 0.25 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, TH * 1.6, 24), faceMat);
    disc.rotation.x = Math.PI / 2;   // axis along Z → flat faces forward
    disc.castShadow = disc.receiveShadow = true;
    g.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.98, 0.02, 8, 24), metalMat);
    rim.position.z = TH * 0.4;
    g.add(rim);
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), metalMat);
    boss.position.z = TH * 0.9;
    g.add(boss);
    this.scene.add(g);
    this.shieldMesh = g;
  }

  get knocked() { return this.knockTimer > 0; }

  get swordArmIntact() {
    return !this.detached.has('upper_arm_r') && !this.detached.has('lower_arm_r');
  }

  // Suspend sword PD control briefly so a clash visibly knocks the blade aside.
  staggerSword(t) { this.swordStagger = Math.max(this.swordStagger, t); }

  // Quick evasive burst in the (dx,dz) direction. Costs stamina, has a cooldown.
  // Returns true if the dodge fired.
  tryDodge(dx, dz) {
    if (this.dodgeCd > 0 || !this.alive || this.knocked || this.downed) return false;
    if (this.stamina < DODGE_COST) return false;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return false;
    const ux = dx / len, uz = dz / len;
    // Impulse per body = mass · Δv, so the whole frame lurches together.
    for (const body of Object.values(this.bodies)) {
      const m = body.mass();
      body.applyImpulse({ x: ux * DODGE_SPEED * m, y: 0, z: uz * DODGE_SPEED * m }, true);
    }
    if (this.swordBody) {
      const m = this.swordBody.mass();
      this.swordBody.applyImpulse({ x: ux * DODGE_SPEED * m, y: 0, z: uz * DODGE_SPEED * m }, true);
    }
    this.stamina = Math.max(0, this.stamina - DODGE_COST);
    this.dodgeCd = DODGE_CD;
    return true;
  }

  // Pure resolution of a blade clash given who (if anyone) is parrying. The
  // parrying side braces (little stagger, less pushback); the attacker is
  // knocked wide, staggered longer, and loses stamina. Kept pure so it's
  // testable independent of the DOM-coupled clash handler in game.js.
  static clashResponse(aParrying, bParrying) {
    if (aParrying && !bParrying)
      return { aStag: 0,    bStag: 0.45, aMul: 0.6, bMul: 1.8, aStam: 0,              bStam: PARRY_STAM_HIT, parry: true };
    if (bParrying && !aParrying)
      return { aStag: 0.45, bStag: 0,    aMul: 1.8, bMul: 0.6, aStam: PARRY_STAM_HIT, bStam: 0,              parry: true };
    return   { aStag: 0.18, bStag: 0.18, aMul: 1,   bMul: 1,   aStam: 0,              bStam: 0,              parry: false };
  }

  pelvisPos() {
    const t = this.bodies.pelvis.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  // cmd: { vx, vz, targetYaw, aimYaw, aimPitch, thrust, reach, power }
  updateControl(dt, cmd) {
    this.strikePower = cmd.power ?? 1;   // read by the contact handler on a hit
    this.impactAccum = Math.max(0, this.impactAccum - 25 * dt);
    if (this.knockTimer > 0)   this.knockTimer   -= dt;
    if (this.swordStagger > 0) this.swordStagger -= dt;
    if (this.dodgeCd > 0)      this.dodgeCd      -= dt;
    this._updateStamina(dt);
    if (!this.alive || this.knocked) return;

    const pelvis = this.bodies.pelvis;
    const torso  = this.bodies.torso;
    const pt = pelvis.translation();
    const pv = pelvis.linvel();

    // A leg has been cut off — no standing. Stay prone and crawl. The sword
    // control below still runs, so he can keep fighting from the ground.
    if (this.downed) {
      this._crawl(dt, cmd, pelvis, torso, pv);
    } else {
    // Ducking drops every target height so the whole body crouches down.
    const crouch = Math.max(0, Math.min(1, cmd.crouch ?? 0));
    const drop   = crouch * DUCK_DROP;

    // ── Levitation: spring pelvis toward (ducked) standing height + gravity ff.
    // Allow a little downward push while crouching so the duck is brisk, not a
    // slow sag waiting on gravity.
    const weight = 48 * 9.81;
    let fy = weight + LEVITATE_KP * ((PELVIS_TARGET_H - drop) - pt.y) - LEVITATE_KD * pv.y;
    fy = Math.max(crouch > 0.05 ? -LEVITATE_MAX * 0.4 : 0, Math.min(LEVITATE_MAX, fy));
    pelvis.applyImpulse({ x: 0, y: fy * dt, z: 0 }, true);

    // Torso lift assist to straighten the spine (lowered target while ducking)
    const tt = torso.translation();
    const tv = torso.linvel();
    let tfy = 300 * ((1.32 - drop) - tt.y) - 50 * tv.y;
    tfy = Math.max(-150, Math.min(400, tfy));
    torso.applyImpulse({ x: 0, y: tfy * dt, z: 0 }, true);

    // Head lift — keeps the neck from drooping (lowered target while ducking)
    const head = this.bodies.head;
    if (!this.detached.has('head')) {
      const ht = head.translation();
      const hv = head.linvel();
      let hfy = 70 * ((1.72 - drop) - ht.y) - 14 * hv.y;
      hfy = Math.max(-60, Math.min(90, hfy));
      head.applyImpulse({ x: 0, y: hfy * dt, z: 0 }, true);
    }

    // ── Upright torque on torso, pelvis, and head.
    // Gains are clamped per body to its discrete stability limit — small
    // inertias (head, pelvis) cannot take the full torso gains without the
    // explicit damping overshooting and vibrating the whole ragdoll.
    const uprightBodies = [['torso', 1.0], ['pelvis', 1.0]];
    if (!this.detached.has('head')) uprightBodies.push(['head', 0.3]);
    for (const [name, scale] of uprightBodies) {
      const b = this.bodies[name];
      const I = this._inertia[name];
      const kp = Math.min(UPRIGHT_KP * scale, 0.35 * I / (dt * dt));
      const kd = Math.min(UPRIGHT_KD * scale, 0.5  * I / dt);
      const r = b.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      _v1.set(0, 1, 0).applyQuaternion(_q);            // current up
      _v2.crossVectors(_v1, new THREE.Vector3(0, 1, 0)); // axis toward world up
      const w = b.angvel();
      const tq = clampVec({
        x: kp * _v2.x - kd * w.x,
        y: -kd * 0.2 * w.y,
        z: kp * _v2.z - kd * w.z,
      }, UPRIGHT_MAX * scale);
      b.applyTorqueImpulse({ x: tq.x * dt, y: tq.y * dt, z: tq.z * dt }, true);
    }

    // ── Yaw control toward targetYaw.
    // Each body uses its own heading error — steering the pelvis by the
    // torso's error leaves it with no anchor and it spins continuously.
    {
      const dx = Math.sin(cmd.targetYaw), dz = Math.cos(cmd.targetYaw);
      for (const b of [torso, pelvis]) {
        const r = b.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        _v1.set(0, 0, 1).applyQuaternion(_q);
        const cross = _v1.z * dx - _v1.x * dz;
        const dot   = _v1.x * dx + _v1.z * dz;
        const err   = Math.atan2(cross, dot);
        const wy = b.angvel().y;
        let ty = YAW_KP * err - YAW_KD * wy;
        ty = Math.max(-YAW_MAX, Math.min(YAW_MAX, ty));
        b.applyTorqueImpulse({ x: 0, y: ty * dt, z: 0 }, true);
      }
    }

    // ── Locomotion: force toward target velocity
    {
      let fx = MOVE_KP * (cmd.vx - pv.x);
      let fz = MOVE_KP * (cmd.vz - pv.z);
      const len = Math.hypot(fx, fz);
      if (len > MOVE_MAX) { fx *= MOVE_MAX / len; fz *= MOVE_MAX / len; }
      pelvis.applyImpulse({ x: fx * dt, y: 0, z: fz * dt }, true);
    }

    // ── Arena containment
    {
      const r = Math.hypot(pt.x, pt.z);
      if (r > 9.3) {
        const k = (r - 9.3) * 220 / r;
        pelvis.applyImpulse({ x: -pt.x * k * dt, y: 0, z: -pt.z * k * dt }, true);
      }
    }

    }

    // ── Sword PD control — the Half Sword part.
    // While staggered from a clash the blade swings free (pure physics), so a
    // parry actually deflects it instead of being instantly re-aimed.
    if (this.swordBody && this.swordArmIntact && this.swordStagger <= 0) {
      // When exhausted the arm can't hold the blade up: force the aim downward
      // and weaken the controller so the heavy sword sags toward the ground.
      const auth     = this.exhausted ? STAM_TIRED_AUTH : 1;
      const aimPitch = this.exhausted ? Math.min(cmd.aimPitch, STAM_DROOP_PITCH) : cmd.aimPitch;
      const reach = cmd.reach ?? (cmd.thrust ? 0.80 : 0.52);
      const yawT  = cmd.targetYaw + cmd.aimYaw;
      const cp = Math.cos(aimPitch), sp = Math.sin(aimPitch);
      const dir = _v1.set(Math.sin(yawT) * cp, sp, Math.cos(yawT) * cp);

      // Shoulder world position (right shoulder local in torso frame)
      const tr  = torso.rotation();
      const ttr = torso.translation();
      _q.set(tr.x, tr.y, tr.z, tr.w);
      const shoulder = new THREE.Vector3(-0.30, 0.14, 0)
        .applyQuaternion(_q)
        .add(new THREE.Vector3(ttr.x, ttr.y, ttr.z));

      const targetGrip = new THREE.Vector3(
        shoulder.x + dir.x * reach,
        shoulder.y + dir.y * reach,
        shoulder.z + dir.z * reach,
      );

      // Current grip position (sword local (0,0,-0.40))
      const sr = this.swordBody.rotation();
      const st = this.swordBody.translation();
      _q.set(sr.x, sr.y, sr.z, sr.w);
      const gripOff = new THREE.Vector3(0, 0, -0.40).applyQuaternion(_q);
      const grip = new THREE.Vector3(st.x + gripOff.x, st.y + gripOff.y, st.z + gripOff.z);
      const sv = this.swordBody.linvel();

      const F = clampVec({
        x: SWORD_KP * auth * (targetGrip.x - grip.x) - SWORD_KD * sv.x,
        y: SWORD_KP * auth * (targetGrip.y - grip.y) - SWORD_KD * sv.y,
        z: SWORD_KP * auth * (targetGrip.z - grip.z) - SWORD_KD * sv.z,
      }, SWORD_MAX_F * auth);
      // At the COM — applying at the grip creates a parasitic torque that
      // overwhelms the blade-alignment torque below.
      this.swordBody.applyImpulse({ x: F.x * dt, y: F.y * dt, z: F.z * dt }, true);

      // Torque to point the blade along the aim direction.
      // Damp only the transverse spin and never inject roll torque: the
      // roll-axis inertia is ~400x smaller, so -kd*w on it is numerically
      // unstable and spins the blade up like a gyroscope.
      const bladeDir = new THREE.Vector3(0, 0, 1).applyQuaternion(_q);
      const sw = this.swordBody.angvel();
      const w  = new THREE.Vector3(sw.x, sw.y, sw.z);
      w.addScaledVector(bladeDir, -w.dot(bladeDir));   // transverse component
      const T = new THREE.Vector3()
        .crossVectors(bladeDir, dir).multiplyScalar(SWORD_T_KP * auth)
        .addScaledVector(w, -SWORD_T_KD);
      T.addScaledVector(bladeDir, -T.dot(bladeDir));   // strip roll torque
      clampVec(T, SWORD_T_MAX * auth);
      this.swordBody.applyTorqueImpulse({ x: T.x * dt, y: T.y * dt, z: T.z * dt }, true);
    }

    this._updateShield(dt, cmd);
  }

  // Hold the left-hand shield up in front of the chest, face toward the foe.
  // The shield body is driven directly; the forearm follows through the strap.
  _updateShield(dt, cmd) {
    if (!this.shieldBody || !this.shieldJoint) return;   // gone or dropped
    if (this.detached.has('lower_arm_l') || this.detached.has('upper_arm_l')) return;
    if (!this.alive || this.knocked) return;

    const torso = this.bodies.torso;
    const tr  = torso.rotation();
    const ttr = torso.translation();
    _q.set(tr.x, tr.y, tr.z, tr.w);
    const shoulder = new THREE.Vector3(0.30, 0.14, 0)
      .applyQuaternion(_q)
      .add(new THREE.Vector3(ttr.x, ttr.y, ttr.z));

    const yaw = cmd.targetYaw;
    const fwd = _v1.set(Math.sin(yaw), 0, Math.cos(yaw));
    // Guard: forearm's length out in front, at roughly chest height.
    const target = new THREE.Vector3(
      shoulder.x + fwd.x * 0.40, ttr.y + 0.08, shoulder.z + fwd.z * 0.40,
    );

    const st = this.shieldBody.translation();
    const sv = this.shieldBody.linvel();
    // Deadzone: once the shield is parked on target and nearly still, stop
    // nudging it so the strapped arm settles instead of jittering at idle.
    const ex = target.x - st.x, ey = target.y - st.y, ez = target.z - st.z;
    if (Math.hypot(ex, ey, ez) > 0.03 || Math.hypot(sv.x, sv.y, sv.z) > 0.1) {
      const F = clampVec({
        x: SHIELD_KP * ex - SHIELD_KD * sv.x,
        y: SHIELD_KP * ey - SHIELD_KD * sv.y,
        z: SHIELD_KP * ez - SHIELD_KD * sv.z,
      }, SHIELD_MAX_F);
      this.shieldBody.applyImpulse({ x: F.x * dt, y: F.y * dt, z: F.z * dt }, true);
    }

    // Point the shield face (local +Z) toward the foe.
    const sr = this.shieldBody.rotation();
    _q.set(sr.x, sr.y, sr.z, sr.w);
    const faceDir = _v2.set(0, 0, 1).applyQuaternion(_q);
    const sw = this.shieldBody.angvel();
    const cx = faceDir.y * fwd.z - faceDir.z * fwd.y;
    const cy = faceDir.z * fwd.x - faceDir.x * fwd.z;
    const cz = faceDir.x * fwd.y - faceDir.y * fwd.x;
    if (Math.hypot(cx, cy, cz) > 0.05 || Math.hypot(sw.x, sw.y, sw.z) > 0.15) {
      const T = clampVec({
        x: cx * SHIELD_T_KP - SHIELD_T_KD * sw.x,
        y: cy * SHIELD_T_KP - SHIELD_T_KD * sw.y,
        z: cz * SHIELD_T_KP - SHIELD_T_KD * sw.z,
      }, SHIELD_T_MAX);
      this.shieldBody.applyTorqueImpulse({ x: T.x * dt, y: T.y * dt, z: T.z * dt }, true);
    }
  }

  // Prone crawl after losing a leg: no levitation (gravity keeps him down),
  // a slow horizontal drag toward the move direction, the chest propped up
  // just enough to aim, and weak yaw so he can still turn toward his target.
  _crawl(dt, cmd, pelvis, torso, pv) {
    // Slow drag toward the intended direction (input speed renormalised down).
    const len = Math.hypot(cmd.vx, cmd.vz);
    let tvx = 0, tvz = 0;
    if (len > 0.01) { tvx = (cmd.vx / len) * CRAWL_SPEED; tvz = (cmd.vz / len) * CRAWL_SPEED; }
    let fx = CRAWL_KP * (tvx - pv.x);
    let fz = CRAWL_KP * (tvz - pv.z);
    const fl = Math.hypot(fx, fz);
    if (fl > CRAWL_MAX) { fx *= CRAWL_MAX / fl; fz *= CRAWL_MAX / fl; }
    pelvis.applyImpulse({ x: fx * dt, y: 0, z: fz * dt }, true);

    // Gentle chest prop — keeps the torso/head off the dirt so he can swing,
    // but far too weak to lift him back onto a (missing) leg.
    const tt = torso.translation();
    const tv = torso.linvel();
    let tfy = 120 * (CRAWL_CHEST_H - tt.y) - 24 * tv.y;
    tfy = Math.max(-40, Math.min(120, tfy));
    torso.applyImpulse({ x: 0, y: tfy * dt, z: 0 }, true);

    // Weak yaw toward the target so he can still face his foe.
    const dx = Math.sin(cmd.targetYaw), dz = Math.cos(cmd.targetYaw);
    for (const b of [torso, pelvis]) {
      const r = b.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      _v1.set(0, 0, 1).applyQuaternion(_q);
      const cross = _v1.z * dx - _v1.x * dz;
      const dot   = _v1.x * dx + _v1.z * dz;
      const err   = Math.atan2(cross, dot);
      const wy = b.angvel().y;
      let ty = YAW_KP * 0.4 * err - YAW_KD * 0.4 * wy;
      ty = Math.max(-YAW_MAX * 0.4, Math.min(YAW_MAX * 0.4, ty));
      b.applyTorqueImpulse({ x: 0, y: ty * dt, z: 0 }, true);
    }

    // Arena containment still applies while crawling.
    const pt = pelvis.translation();
    const rad = Math.hypot(pt.x, pt.z);
    if (rad > 9.3) {
      const k = (rad - 9.3) * 220 / rad;
      pelvis.applyImpulse({ x: -pt.x * k * dt, y: 0, z: -pt.z * k * dt }, true);
    }
  }

  // Returns { severed, dead }
  applyDamage(part, dmg) {
    if (this.detached.has(part)) return { severed: false, dead: false };
    this.hp[part] -= dmg;
    this._flash(part);
    this.impactAccum += dmg;

    let severed = false, dead = false;
    if (VITAL.has(part)) {
      if (this.hp[part] <= 0) {
        if (part === 'head' && this.joints['head']) this._sever('head');
        if (this.alive) { this._die(); dead = true; }
      }
    } else {
      // Sever only once the limb has soaked up its full sever requirement.
      const taken = PARTS[part].hp - this.hp[part];
      const need  = Math.max(PARTS[part].hp * SEVER_MARGIN, SEVER_FLOOR);
      if (taken >= need) {
        this._sever(part);
        severed = true;
      }
    }

    if (this.alive && this.impactAccum > KNOCK_THRESHOLD) {
      this.knockTimer  = 1.7 + Math.random() * 0.6;
      this.impactAccum = 0;
    }
    return { severed, dead };
  }

  // Unstrap the shield and let it fall away (keeps lying in the arena).
  _dropShield() {
    if (this.shieldJoint) {
      this.physics.removeJoint(this.shieldJoint);
      this.shieldJoint = null;
    }
  }

  _sever(part) {
    if (this.detached.has(part)) return;
    this.detached.add(part);
    // Lose a leg → go prone; drop the shield so it doesn't anchor the crawl.
    if (part.includes('leg')) { this.downed = true; this._dropShield(); }
    const joint = this.joints[part];
    if (joint) {
      this.physics.removeJoint(joint);
      this.joints[part] = null;
    }
    // Blood cap
    const def = PARTS[part];
    const cap = new THREE.Mesh(
      new THREE.CircleGeometry(def.half[0] * 0.9, 8),
      new THREE.MeshStandardMaterial({ color: 0x8b0000, side: THREE.DoubleSide })
    );
    cap.position.y = def.half[1];
    cap.rotation.x = Math.PI / 2;
    this.meshes[part].add(cap);
  }

  _die() {
    this.alive = false; // controllers stop → body collapses under gravity
  }

  _flash(part) {
    const mesh = this.meshes[part];
    if (!mesh) return;
    const m = mesh.material;
    const orig = m.color.getHex();
    m.color.setHex(0xff3333);
    setTimeout(() => m.color.setHex(orig), 110);
  }

  syncMeshes() {
    for (const [name, body] of Object.entries(this.bodies)) {
      const t = body.translation();
      const r = body.rotation();
      this.meshes[name].position.set(t.x, t.y, t.z);
      this.meshes[name].quaternion.set(r.x, r.y, r.z, r.w);
    }
    if (this.swordBody) {
      const t = this.swordBody.translation();
      const r = this.swordBody.rotation();
      this.swordMesh.position.set(t.x, t.y, t.z);
      this.swordMesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    if (this.shieldBody) {
      const t = this.shieldBody.translation();
      const r = this.shieldBody.rotation();
      this.shieldMesh.position.set(t.x, t.y, t.z);
      this.shieldMesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  // Mid-blade world velocity — used for impact damage
  swordStrikeVelocity() {
    if (!this.swordBody) return new THREE.Vector3();
    const lv = this.swordBody.linvel();
    const av = this.swordBody.angvel();
    const r  = this.swordBody.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const mid = _v1.set(0, 0, 0.2).applyQuaternion(_q);
    return new THREE.Vector3(
      lv.x + (av.y * mid.z - av.z * mid.y),
      lv.y + (av.z * mid.x - av.x * mid.z),
      lv.z + (av.x * mid.y - av.y * mid.x),
    );
  }

  // Damage a blade contact deals at the given relative impact speed (m/s).
  static impactDamage(speed) {
    return Math.min(DAMAGE_CAP, (speed - 1.2) * 11) * DAMAGE_SCALE;
  }

  // Drain stamina for swinging the blade fast and for holding it raised; recover
  // when resting. Exhaustion latches with hysteresis so the fighter must rest.
  _updateStamina(dt) {
    if (!this.swordBody || !this.swordArmIntact) {
      this.stamina   = Math.min(MAX_STAMINA, this.stamina + STAM_REGEN * dt);
      this.exhausted = false;
      return;
    }
    const speed = this.swordStrikeVelocity().length();
    const r = this.swordBody.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const bladeUp = _v1.set(0, 0, 1).applyQuaternion(_q).y;   // +1 = blade points up
    const raised  = Math.asin(Math.max(-1, Math.min(1, bladeUp)));

    let cost = 0;
    if (speed > STAM_SWING_FLOOR) cost += (speed - STAM_SWING_FLOOR) * STAM_SWING_COST;
    if (raised > 0.1)             cost += raised * STAM_HOLD_COST;

    if (cost > 0) this.stamina = Math.max(0, this.stamina - cost * dt);
    else          this.stamina = Math.min(MAX_STAMINA, this.stamina + STAM_REGEN * dt);

    if (this.stamina <= STAM_EXHAUST_AT)      this.exhausted = true;
    else if (this.stamina >= STAM_RECOVER_AT) this.exhausted = false;
  }

  staminaFraction() { return this.stamina / MAX_STAMINA; }

  // Per-part health, in core→extremity order, for the HUD breakdown.
  partHealth() {
    return Object.entries(PARTS).map(([name, def]) => ({
      name,
      frac:     this.detached.has(name) ? 0 : Math.max(0, Math.min(this.hp[name], def.hp)) / def.hp,
      detached: this.detached.has(name),
    }));
  }

  totalHpFraction() {
    let sum = 0;
    for (const [name, def] of Object.entries(PARTS)) {
      sum += Math.max(0, Math.min(this.hp[name], def.hp));
    }
    return sum / MAX_TOTAL_HP;
  }
}
