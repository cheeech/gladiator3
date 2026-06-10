import * as THREE from 'three';

export class ThirdPersonCamera {
  constructor(threeCamera) {
    this.cam    = threeCamera;
    this.yaw    = 0;      // horizontal orbit angle
    this.pitch  = 0.28;   // vertical tilt (radians, clamped)
    this.dist   = 5.5;
    this._smoothPos = new THREE.Vector3();
    this._initialized = false;
  }

  update(targetPos, mouseDX, mouseDY) {
    this.yaw   -= mouseDX * 0.0025;
    this.pitch  = Math.max(0.08, Math.min(0.62, this.pitch - mouseDY * 0.0025));

    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);

    const idealX = targetPos.x + sy * cp * this.dist;
    const idealY = targetPos.y + sp * this.dist + 1.1;
    const idealZ = targetPos.z + cy * cp * this.dist;

    if (!this._initialized) {
      this._smoothPos.set(idealX, idealY, idealZ);
      this._initialized = true;
    } else {
      this._smoothPos.lerp(new THREE.Vector3(idealX, idealY, idealZ), 0.14);
    }

    this.cam.position.copy(this._smoothPos);
    this.cam.lookAt(targetPos.x, targetPos.y + 1.1, targetPos.z);
  }

  // World-space forward direction (horizontal, for WASD)
  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  get right() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  // Yaw angle the player should face (camera's looking direction)
  get playerFacing() {
    return this.yaw + Math.PI;
  }
}
