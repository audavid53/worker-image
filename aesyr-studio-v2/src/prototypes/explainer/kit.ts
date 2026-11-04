// Building blocks for the two explainer scene styles (see .claude/skills/scene-*/SKILL.md).
import * as THREE from "three";
import { Text } from "troika-three-text";
import inter500 from "@fontsource/inter/files/inter-latin-500-normal.woff?url";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff?url";
import inter700 from "@fontsource/inter/files/inter-latin-700-normal.woff?url";

export const FONT = { 500: inter500, 600: inter600, 700: inter700 } as const;

/** Section tints measured from the reference (REPORT.md §2). */
export const TINT = { warm: "#FDFAF9", blue: "#DFE9ED", peach: "#FAE8E2", mint: "#ECF6F2", lavender: "#EEE7F5", white: "#FDFDFD" } as const;
/** Cast / cursor / keyword hues. */
export const HUE = { violet: "#8B5CF6", coral: "#F2765A", green: "#5FB86A", sky: "#5B9BE0", ink: "#141416" } as const;

// ---------------------------------------------------------------------------
// Screen-space background: tint + halftone grid that fades in from the edges.
// Rendered with its own ortho camera so it stays put while the scene camera zooms.
// ---------------------------------------------------------------------------

export class Background {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTint: { value: new THREE.Color(TINT.warm) },
        uTint2: { value: new THREE.Color(TINT.warm) },
        uRes: { value: new THREE.Vector2(1280, 720) },
        uDot: { value: 0.016 },
      },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: `
        uniform vec3 uTint; uniform vec3 uTint2; uniform vec2 uRes; uniform float uDot; varying vec2 vUv;
        void main(){
          vec3 base = mix(uTint, uTint2, smoothstep(0.0, 1.0, vUv.y));
          float pitch = uDot * uRes.y;                       // dot pitch in px
          vec2 p = gl_FragCoord.xy / pitch;
          vec2 cell = fract(p) - 0.5;
          vec2 c = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
          float edge = smoothstep(0.35, 0.85, length(c) * 1.25); // clear centre, dots toward the edges
          float r = mix(0.08, 0.26, edge);
          float dotMask = 1.0 - smoothstep(r - 0.06, r, length(cell));
          vec3 dotCol = base * 0.93;                         // subtle: the reference texture is barely there
          gl_FragColor = vec4(mix(base, dotCol, dotMask * edge * 0.6), 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  /** Section tint (bottom → top). Shots call this every frame. */
  set(tint: string, tint2 = tint) {
    this.mat.uniforms.uTint.value.set(tint);
    this.mat.uniforms.uTint2.value.set(tint2);
  }

  /** Drawing-buffer size in px, so the dot pitch is a fixed share of frame height. */
  size(w: number, h: number) {
    this.mat.uniforms.uRes.value.set(w, h);
  }
}

// ---------------------------------------------------------------------------
// UI primitives
// ---------------------------------------------------------------------------

export function roundedRect(w: number, h: number, r: number, color: string, opacity = 1): THREE.Mesh {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return new THREE.Mesh(new THREE.ShapeGeometry(s, 12), new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

/** Soft drop shadow under a card: blurred rounded-rect texture, offset down, ~12% opacity. */
export function softShadow(w: number, h: number, r: number, opacity = 0.13): THREE.Mesh {
  const c = document.createElement("canvas");
  const pad = 64;
  c.width = 256 + pad * 2;
  c.height = Math.round(256 * (h / w)) + pad * 2;
  const g = c.getContext("2d")!;
  g.filter = "blur(22px)";
  g.fillStyle = "#000";
  const rr = (r / w) * 256;
  g.beginPath();
  g.roundRect(pad, pad, 256, c.height - pad * 2, rr);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w * (c.width / 256), h * (c.height / (c.height - pad * 2))),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false }),
  );
  m.position.set(0, -h * 0.03, -0.002);
  return m;
}

export function label(text: string, size: number, color: string = HUE.ink, weight: 500 | 600 | 700 = 600, anchorX: "left" | "center" | "right" = "left"): Text {
  const t = new Text();
  t.text = text;
  t.font = FONT[weight];
  t.fontSize = size;
  t.color = color;
  t.anchorX = anchorX;
  t.anchorY = "middle";
  t.letterSpacing = -0.02;
  t.sync();
  return t;
}

/** A browser window: white rounded panel, title bar with traffic lights and a tab pill. */
export function browserWindow(w: number, h: number, tab = "New Tab") {
  const g = new THREE.Group();
  const r = h * 0.035;
  g.add(softShadow(w, h, r));
  g.add(roundedRect(w, h, r, "#FFFFFF"));
  const bar = h * 0.07;
  const lights = ["#FF5F57", "#FEBC2E", "#28C840"];
  lights.forEach((c, i) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(w * 0.0075, 24), new THREE.MeshBasicMaterial({ color: c }));
    d.position.set(-w / 2 + w * 0.025 + i * w * 0.022, h / 2 - bar / 2, 0.001);
    g.add(d);
  });
  const pill = roundedRect(w * 0.16, bar * 0.62, bar * 0.2, "#F3F3F5");
  pill.position.set(-w / 2 + w * 0.17, h / 2 - bar / 2, 0.001);
  g.add(pill);
  const t = label(tab, bar * 0.3, "#3A3A3C", 500);
  t.position.set(-w / 2 + w * 0.11, h / 2 - bar / 2, 0.002);
  g.add(t);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(w, h * 0.002), new THREE.MeshBasicMaterial({ color: "#EDEDEF" }));
  line.position.set(0, h / 2 - bar, 0.001);
  g.add(line);
  return g;
}

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

const toonRamp = (() => {
  const steps = [90, 150, 200, 235, 255]; // 5-step soft toon ramp
  const tex = new THREE.DataTexture(new Uint8Array(steps.flatMap((v) => [v, v, v, 255])), steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

export const toon = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: toonRamp });

function blob(size: number, opacity: number) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, "rgba(0,0,0,1)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity, depthWrite: false }));
}

/** Agent cursor: extruded, bevelled triangle in the agent's hue with a soft offset shadow. */
export function agentCursor(hue: string, size: number) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(size * 0.95, -size * 0.38);
  s.lineTo(size * 0.38, -size * 0.52);
  s.lineTo(size * 0.2, -size * 1.0);
  s.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: size * 0.15, bevelEnabled: true, bevelSize: size * 0.06, bevelThickness: size * 0.06, bevelSegments: 3 });
  const mesh = new THREE.Mesh(geo, toon(hue));
  mesh.rotation.set(0.35, -0.25, 0);
  const shadow = blob(size * 1.6, 0.22);
  shadow.position.set(size * 0.55, -size * 0.75, -size * 0.3);
  g.add(shadow, mesh);
  return g;
}

/** User cursor: white pointing hand with a dark outline (drawn once to a canvas). */
export function handCursor(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.lineJoin = "round";
  g.lineWidth = 6;
  g.strokeStyle = "#1C1C1E";
  g.fillStyle = "#FFFFFF";
  const p = new Path2D();
  p.roundRect(44, 6, 20, 64, 10); // index finger
  p.roundRect(62, 40, 18, 44, 9);
  p.roundRect(78, 46, 18, 40, 9);
  p.roundRect(94, 54, 16, 34, 8);
  p.roundRect(40, 60, 70, 56, 22); // palm
  p.roundRect(22, 64, 28, 18, 9); // thumb
  g.shadowColor = "rgba(0,0,0,0.25)";
  g.shadowBlur = 8;
  g.shadowOffsetY = 3;
  g.fill(p);
  g.shadowColor = "transparent";
  g.stroke(p);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  // hotspot at the fingertip (top-left area of the image)
  m.geometry.translate(size * 0.07, -size * 0.45, 0);
  return m;
}

// ---------------------------------------------------------------------------
// Stand-in toy mascot (replaced by a Tripo GLB when one is loaded)
// ---------------------------------------------------------------------------

export interface Mascot {
  root: THREE.Group;
  /** Pose for a frame: run cycle phase, or idle. */
  pose(f: number, mode: "run" | "idle" | "wave"): void;
}

export function toyMascot(hue: string, darker: string, height = 1): Mascot {
  const root = new THREE.Group();
  const H = height;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(H * 0.13, H * 0.16, 6, 16), toon(darker));
  body.position.y = H * 0.42;
  const head = new THREE.Mesh(new THREE.SphereGeometry(H * 0.2, 32, 24), toon(hue));
  head.scale.set(1, 0.95, 0.92);
  head.position.y = H * 0.74;
  const hat = new THREE.Mesh(new THREE.SphereGeometry(H * 0.205, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), toon(hue));
  hat.position.y = H * 0.77;
  hat.scale.set(1.04, 0.85, 1);
  const eyeGeo = new THREE.SphereGeometry(H * 0.035, 16, 12);
  const eyeMat = new THREE.MeshBasicMaterial({ color: "#121214" });
  const eyes = [-1, 1].map((sx) => {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.scale.set(0.8, 1.15, 0.5);
    e.position.set(sx * H * 0.07, H * 0.72, H * 0.17);
    return e;
  });
  const limb = (len: number, r: number, color: string) => {
    const pivot = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), toon(color));
    m.position.y = -len / 2 - r;
    pivot.add(m);
    return pivot;
  };
  const legs = [-1, 1].map((sx) => {
    const l = limb(H * 0.16, H * 0.05, darker);
    l.position.set(sx * H * 0.06, H * 0.3, 0);
    return l;
  });
  const arms = [-1, 1].map((sx) => {
    const a = limb(H * 0.13, H * 0.04, darker);
    a.position.set(sx * H * 0.15, H * 0.52, 0);
    a.rotation.z = sx * 0.25;
    return a;
  });
  // Poses animate this inner rig, so a shot can place `root` freely without the bob overwriting it.
  const rig = new THREE.Group();
  rig.add(body, head, hat, ...eyes, ...legs, ...arms);
  root.add(rig);
  return {
    root,
    pose(f, mode) {
      const t = f / 24;
      if (mode === "run") {
        const ph = t * Math.PI * 2 * 2.2; // ~2.2 strides/s
        legs[0].rotation.x = Math.sin(ph) * 0.9;
        legs[1].rotation.x = -Math.sin(ph) * 0.9;
        arms[0].rotation.x = -Math.sin(ph) * 1.0;
        arms[1].rotation.x = Math.sin(ph) * 1.0;
        rig.position.y = Math.abs(Math.sin(ph)) * H * 0.04;
        rig.rotation.z = -0.08;
      } else if (mode === "wave") {
        arms[1].rotation.z = -2.4 + Math.sin(t * Math.PI * 2 * 2.5) * 0.35;
        rig.position.y = 0;
      } else {
        rig.position.y = Math.sin(t * Math.PI * 2 * 0.5) * H * 0.008;
        rig.rotation.z = 0;
        legs.forEach((l) => (l.rotation.x = 0));
        arms[0].rotation.x = arms[1].rotation.x = 0;
      }
    },
  };
}
