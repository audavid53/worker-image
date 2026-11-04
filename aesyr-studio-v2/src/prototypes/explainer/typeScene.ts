// Test shot for the "kinetic type + mascots" style (skill: scene-kinetic-type-mascot).
// K2 word swap on beats → K4 run-across → K3 mascot pass-through wipe → K6 brand reveal.
import * as THREE from "three";
import { HUE, TINT, label, toyMascot, type Background, type Mascot } from "./kit";
import { BEAT, backOut, clamp01, span } from "./timing";

export const TYPE_FRAMES = 132;

const SWAP: [string, string][] = [
  ["faster", HUE.violet],
  ["smarter", HUE.green],
  ["together", HUE.coral],
];

export function buildTypeScene(bg: Background, makeCast?: () => Mascot[]) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#d8d2cc", 2.0));
  const key = new THREE.DirectionalLight("#ffffff", 1.8);
  key.position.set(-2, 3, 5);
  scene.add(key);

  const lead = label("Launch", 0.13, HUE.ink, 700, "right");
  lead.position.set(-0.02, 0.12, 0);
  const swap = SWAP.map(([w, c]) => {
    const t = label(w, 0.13, c, 700, "left");
    t.position.set(0.02, 0.12, 0);
    scene.add(t);
    return t;
  });
  scene.add(lead);

  const brand = new THREE.Group();
  const mark = new THREE.Group();
  [[-1, 0], [1, 0], [0, 1], [0, -1], [0, 0]].forEach(([x, y], i) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.018, 24), new THREE.MeshBasicMaterial({ color: i === 4 ? HUE.coral : "#F29C7E" }));
    d.position.set(x * 0.032, y * 0.032, 0);
    mark.add(d);
  });
  const word = label("Northwind", 0.075, HUE.ink, 600, "left");
  word.position.set(0.07, 0, 0);
  brand.add(mark, word);
  brand.position.set(-0.2, 0, 0);
  scene.add(brand);

  // Cast: stand-ins unless a Tripo GLB was loaded (makeCast).
  const cast: Mascot[] = makeCast?.() ?? [
    toyMascot("#B9A6F2", "#5E4E9E", 0.42),
    toyMascot("#E98A86", "#8E3F3A", 0.42),
    toyMascot("#B7DC86", "#4E7A3A", 0.42),
  ];
  cast.forEach((m) => scene.add(m.root));
  const hero = makeCast?.()[0] ?? toyMascot("#E98A86", "#8E3F3A", 0.42);
  scene.add(hero.root);

  const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.01, 50);
  const D = 1 / (2 * Math.tan(THREE.MathUtils.degToRad(15)));
  cam.position.set(0, 0, D);
  cam.lookAt(0, 0, 0);

  const pop = (t: { scale: THREE.Vector3; visible: boolean }, f: number, at: number, out?: number) => {
    const u = clamp01((f - at) / 6);
    const o = out === undefined ? 0 : clamp01((f - out) / 4);
    t.visible = f >= at && o < 1;
    t.scale.setScalar(Math.max(0.0001, (0.6 + 0.4 * backOut(u)) * (1 - 0.1 * o)));
  };

  return {
    scene,
    camera: cam,
    update(f: number) {
      bg.set(TINT.warm);

      // K2: "Launch" + a keyword that swaps on every beat (pop 6 f, back-out; outgoing shrinks 4 f)
      pop(lead, f, 0, 100);
      SWAP.forEach((_, i) => pop(swap[i], f, BEAT * (i + 1), i < SWAP.length - 1 ? BEAT * (i + 2) - 4 : 100));

      // K4: run-across, staggered 5 f, parallax 1.0 / 0.9 / 0.8
      cast.forEach((m, i) => {
        const u = (f - 52 - i * 5) / 46;
        m.root.visible = u > 0 && u < 1;
        // feet low in frame so heads stay under the headline (a mascot never covers the keyword)
        m.root.position.set(-1.3 + u * 2.6 * (1 - i * 0.1), -0.5 - i * 0.02, -i * 0.15);
        m.root.rotation.y = Math.PI / 2;
        m.pose(f, "run");
      });

      // K3: pass-through wipe — the hero turns toward the lens and fills the frame (12 f),
      // the brand is behind it when it clears; exit with a 3-frame smear.
      const inU = span(f, 98, 110);
      const exitU = clamp01((f - 112) / 3);
      hero.root.visible = f >= 98 && exitU < 1;
      // walk into the lens with the torso (≈ half the 0.42 height) arriving on the camera axis
      hero.root.position.set(0, -0.4 + inU * (0.4 - 0.21), inU * (D - 0.24)); // close enough that the body covers the frame edge to edge
      hero.root.scale.set(1 + exitU * 0.6, 1 - exitU * 0.3, 1);
      hero.root.position.x = exitU * 0.8;
      hero.root.rotation.y = 0;
      hero.pose(f, "idle");

      // K6: brand reveal behind the wipe (mark pops 8 f, word slides out 8 f)
      brand.visible = f >= 110;
      mark.scale.setScalar(Math.max(0.0001, backOut(clamp01((f - 110) / 8))));
      const slide = span(f, 114, 122);
      word.position.x = 0.07 - (1 - slide) * 0.12;
      (word.material as THREE.Material & { opacity: number }).opacity = slide;
      word.fillOpacity = slide;
    },
  };
}
