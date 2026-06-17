// Rapier wrapper — dynamic bodies, joints, collision events, arena statics.

// Collision groups: (memberships << 16) | filter
export const G_WORLD  = 0x0001;
export const G_P_BODY = 0x0002;
export const G_P_WPN  = 0x0004;
export const G_E_BODY = 0x0008;
export const G_E_WPN  = 0x0010;

export function groups(memberships, filter) {
  return (memberships << 16) | filter;
}

export class PhysicsWorld {
  constructor(RAPIER) {
    this.RAPIER     = RAPIER;
    this.world      = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
    this.meta       = new Map(); // collider handle -> tag
    try { this.world.numSolverIterations = 8; } catch { /* older rapier */ }
  }

  // Substepped: joint chains driven by stiff controllers jitter at 60Hz;
  // solving twice at half the timestep keeps the limbs quiet.
  step(dt, onContactStart) {
    const SUBSTEPS = 2;
    this.world.timestep = Math.min(dt, 0.0333) / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS; i++) {
      this.world.step(this.eventQueue);
      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        if (!started || !onContactStart) return;
        const m1 = this.meta.get(h1);
        const m2 = this.meta.get(h2);
        if (m1 && m2) onContactStart(m1, m2);
      });
    }
  }

  tag(collider, info) {
    this.meta.set(collider.handle, info);
  }

  createDynamicBox({ pos, rot, half, mass, linDamp = 0.15, angDamp = 1.2,
                     friction = 0.6, restitution = 0.0, ccd = false,
                     collisionGroups, events = true }) {
    const { RAPIER } = this;
    let desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(linDamp)
      .setAngularDamping(angDamp)
      .setCanSleep(false);
    if (rot) desc = desc.setRotation(rot);
    // Continuous collision detection — thin, fast-swung blades would otherwise
    // tunnel straight through each other between substeps.
    if (ccd) desc = desc.setCcdEnabled(true);
    const body = this.world.createRigidBody(desc);

    let colDesc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setMass(mass)
      .setFriction(friction)
      .setRestitution(restitution);
    if (collisionGroups !== undefined) colDesc = colDesc.setCollisionGroups(collisionGroups);
    if (events) colDesc = colDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(colDesc, body);

    return { body, collider };
  }

  sphericalJoint(bodyA, bodyB, anchorA, anchorB) {
    const data = this.RAPIER.JointData.spherical(anchorA, anchorB);
    return this.world.createImpulseJoint(data, bodyA, bodyB, true);
  }

  removeJoint(joint) {
    this.world.removeImpulseJoint(joint, true);
  }

  buildArenaStatics() {
    const { RAPIER } = this;
    const g = groups(G_WORLD, 0xffff);

    // Ground
    const groundBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0)
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(25, 0.1, 25).setFriction(1.0).setCollisionGroups(g),
      groundBody
    );

    // Invisible perimeter wall segments
    const R = 10.6;
    for (let i = 0; i < 16; i++) {
      const a    = (i / 16) * Math.PI * 2;
      const yaw  = -a;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(Math.cos(a) * R, 1.5, Math.sin(a) * R)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.4, 1.5, 2.2).setFriction(0.4).setCollisionGroups(g),
        body
      );
    }
  }
}
