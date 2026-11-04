// Builds three.js meshes from a validated Code3DSpec (data only, never executable code).
import * as THREE from "three";
import type { Code3DSpec } from "../../shared/casting";

const DEG = Math.PI / 180;
export const STUDIO_BG = 0x56565c;

function geometry(shape: Code3DSpec["parts"][number]["shape"], [x, y, z]: [number, number, number]): THREE.BufferGeometry {
  switch (shape) {
    case "box":
      return new THREE.BoxGeometry(x, y, z);
    case "sphere":
      return new THREE.SphereGeometry(x / 2, 24, 16);
    case "capsule": {
      const r = x / 2;
      return new THREE.CapsuleGeometry(r, Math.max(0.001, y - 2 * r), 6, 16);
    }
    case "cylinder":
      return new THREE.CylinderGeometry(x / 2, x / 2, y, 24);
    case "cone":
      return new THREE.ConeGeometry(x / 2, y, 24);
    case "torus": {
      const tube = Math.max(0.005, y / 2);
      return new THREE.TorusGeometry(Math.max(tube, x / 2 - tube), tube, 12, 32);
    }
  }
}

export function buildModel(spec: Code3DSpec): THREE.Group {
  const group = new THREE.Group();
  for (const part of spec.parts) {
    const mesh = new THREE.Mesh(
      geometry(part.shape, part.size),
      new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.75, metalness: 0.05, flatShading: true }),
    );
    mesh.name = part.name;
    mesh.position.set(...part.position);
    mesh.rotation.set(part.rotation[0] * DEG, part.rotation[1] * DEG, part.rotation[2] * DEG);
    group.add(mesh);
  }
  return group;
}

export function disposeModel(group: THREE.Object3D) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}

/** Scene with lights and a ground disc; returns a camera framed on the model. */
export function stage(model: THREE.Group, aspect: number) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2a30, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.1) * 0.75;

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 1.4, 48),
    new THREE.MeshStandardMaterial({ color: 0x77777e, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = box.min.y - 0.001;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(35, aspect, radius / 50, radius * 50);
  const dist = radius / Math.sin((35 * DEG) / 2);
  return { scene, camera, centre, dist, ground };
}

export function placeCamera(camera: THREE.PerspectiveCamera, centre: THREE.Vector3, dist: number, yaw: number, pitch: number) {
  camera.position.set(
    centre.x + dist * Math.cos(pitch) * Math.sin(yaw),
    centre.y + dist * Math.sin(pitch),
    centre.z + dist * Math.cos(pitch) * Math.cos(yaw),
  );
  camera.lookAt(centre);
}

// One offscreen renderer for every thumbnail.
let shared: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();

export function snapshot(key: string, spec: Code3DSpec, size = 320): string | null {
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    shared ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    shared.setSize(size, size, false);
    const model = buildModel(spec);
    const s = stage(model, 1);
    placeCamera(s.camera, s.centre, s.dist, 35 * DEG, 12 * DEG);
    // Mid-grey studio backdrop so dark costumes stay readable on the dark UI.
    shared.setClearColor(STUDIO_BG, 1);
    shared.render(s.scene, s.camera);
    const url = shared.domElement.toDataURL("image/png");
    disposeModel(model);
    s.ground.geometry.dispose();
    (s.ground.material as THREE.Material).dispose();
    cache.set(key, url);
    return url;
  } catch {
    return null; // no WebGL (e.g. headless); the card shows a placeholder
  }
}
