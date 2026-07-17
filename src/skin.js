import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Drape a rigged character over a physics ragdoll. The GLB (a Mixamo "X Bot"
// split in Blender into separate, origin-centred per-part meshes) provides one
// mesh per body part named exactly like our rig. We simply swap each box mesh
// for the matching GLB mesh and hand it to the ragdoll — `syncMeshes` then poses
// it from physics every frame, no skeleton driving required.

const DEFAULT_URL = '/models/gladiator.glb';

// Parts the GLB ships as separate meshes (it has no pelvis — torso/legs cover it).
const PART_MESHES = [
  'torso', 'head',
  'upper_arm_l', 'upper_arm_r', 'lower_arm_l', 'lower_arm_r',
  'upper_leg_l', 'upper_leg_r', 'lower_leg_l', 'lower_leg_r',
];

const _loader = new GLTFLoader();
const _cache = new Map();   // url -> Promise<gltf>
function loadModel(url) {
  if (!_cache.has(url)) {
    _cache.set(url, new Promise((res, rej) => _loader.load(url, res, undefined, rej)));
  }
  return _cache.get(url);
}

export class GlbAvatar {
  constructor(scene, ragdoll, { url = DEFAULT_URL, tint = null, faceYaw = 0 } = {}) {
    this.scene   = scene;
    this.ragdoll = ragdoll;
    this.tint    = tint;
    this.faceYaw = faceYaw;
    this.ready   = false;
    this._added  = [];
    loadModel(url)
      .then(g => { try { this._apply(g); } catch (e) { console.warn('[skin] setup failed', e); } })
      .catch(e => console.warn('[skin] GLB load failed, keeping box meshes:', e));
  }

  _apply(gltf) {
    const src = {};
    gltf.scene.traverse(o => { if (o.isMesh) src[o.name] = o; });

    let swapped = 0;
    for (const part of PART_MESHES) {
      const from = src[part];
      const box  = this.ragdoll.meshes[part];
      if (!from || !box) { if (!from) console.warn('[skin] GLB missing part:', part); continue; }

      const mesh = from.clone();
      // Independent material(s) so each fighter tints separately and a hit-flash
      // on one part doesn't bleed into others.
      mesh.material = Array.isArray(from.material)
        ? from.material.map(m => m.clone())
        : from.material.clone();
      this._tint(mesh.material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.scale.set(1, 1, 1);

      // The GLB was authored for a different skeleton: its parts sit at their own
      // rest positions, which differ from this rig's. Shift the geometry by
      // (authored centre − our rest centre) so the model reassembles in its
      // correct proportions when each part is driven from our body centre.
      const rest = this.ragdoll.restPos[part];
      if (rest) {
        const off = from.position;   // GLB node translation = authored part centre
        const geo = from.geometry.clone();
        geo.translate(off.x - rest[0], off.y - rest[1], off.z - rest[2]);
        mesh.geometry = geo;
        // Mark the foot's lowest local point so syncMeshes can keep it from ever
        // dipping below the ground.
        if (part.startsWith('lower_leg')) {
          geo.computeBoundingBox();
          mesh.userData.footPt = new THREE.Vector3(0, geo.boundingBox.min.y, 0);
        }
      }

      // Take over the box's current transform; syncMeshes drives it from here.
      mesh.position.copy(box.position);
      mesh.quaternion.copy(box.quaternion);
      this.scene.remove(box);
      this.scene.add(mesh);
      this.ragdoll.meshes[part] = mesh;
      this._added.push(mesh);
      swapped++;
    }

    if (swapped === 0) { console.warn('[skin] no parts swapped — keeping boxes'); return; }

    // No pelvis mesh in the GLB — hide that box so it doesn't poke through.
    const pelvis = this.ragdoll.meshes['pelvis'];
    if (pelvis) pelvis.visible = false;

    this.ready = true;
  }

  _tint(material) {
    if (this.tint == null) return;
    const c = new THREE.Color(this.tint);
    const f = m => { if (m && m.emissive) { m.emissive = c; m.emissiveIntensity = 0.35; } };
    Array.isArray(material) ? material.forEach(f) : f(material);
  }

  // No per-frame work: ragdoll.syncMeshes already poses the swapped meshes.
  update() {}

  dispose() {
    for (const m of this._added) this.scene.remove(m);
    this._added = [];
    this.ready = false;
  }
}
