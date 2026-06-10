import * as THREE from 'three';

// Visuals only — physics statics are created in PhysicsWorld.buildArenaStatics()
export function buildArena(scene) {
  // Sandy floor disc
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(11, 11, 0.25, 48),
    new THREE.MeshStandardMaterial({ color: 0xc2a06e, roughness: 1.0 })
  );
  floor.position.y = -0.125;
  floor.receiveShadow = true;
  scene.add(floor);

  // Arena perimeter wall (torus)
  const wall = new THREE.Mesh(
    new THREE.TorusGeometry(10.5, 0.6, 10, 48),
    new THREE.MeshStandardMaterial({ color: 0x8a6840, roughness: 0.9 })
  );
  wall.rotation.x = Math.PI / 2;
  wall.position.y = 0.7;
  wall.castShadow = true;
  scene.add(wall);

  // Stone columns around the ring
  const colMat = new THREE.MeshStandardMaterial({ color: 0xd4c5a0, roughness: 0.85 });
  const colGeo = new THREE.CylinderGeometry(0.28, 0.32, 5, 8);
  for (let i = 0; i < 8; i++) {
    const a   = (i / 8) * Math.PI * 2;
    const col = new THREE.Mesh(colGeo, colMat);
    col.position.set(Math.cos(a) * 10, 2.5, Math.sin(a) * 10);
    col.castShadow = true;
    scene.add(col);
  }

  // Scattered rocks for detail
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a7e5e, roughness: 1.0 });
  for (let i = 0; i < 18; i++) {
    const r = Math.random() * 7.5 + 1.5;
    const a = Math.random() * Math.PI * 2;
    const s = Math.random() * 0.14 + 0.05;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s), rockMat);
    rock.position.set(Math.cos(a) * r, s * 0.5, Math.sin(a) * r);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    scene.add(rock);
  }

  // Lighting
  const sun = new THREE.DirectionalLight(0xfff5d0, 2.8);
  sun.position.set(8, 18, 6);
  sun.castShadow              = true;
  sun.shadow.mapSize.width    = 2048;
  sun.shadow.mapSize.height   = 2048;
  sun.shadow.camera.near      = 0.5;
  sun.shadow.camera.far       = 60;
  sun.shadow.camera.left      = -16;
  sun.shadow.camera.right     = 16;
  sun.shadow.camera.top       = 16;
  sun.shadow.camera.bottom    = -16;
  sun.shadow.bias             = -0.001;
  scene.add(sun);

  scene.add(new THREE.AmbientLight(0xffe0b0, 0.55));
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0xc2a06e, 0.45));
}
