// Test bench for the character-product-explainer template: renders one shot sequence per scene
// style, frame-exact, with a scrubber. Open with ?prototype=explainer.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Background, type Mascot } from "./kit";
import { FPS } from "./timing";
import { UI_FRAMES, buildUiScene } from "./uiScene";
import { TYPE_FRAMES, buildTypeScene } from "./typeScene";

type Style = "type" | "ui";

/** Wraps a loaded GLB as a mascot: height-normalised clone, clips chosen by name (run/walk, idle, wave). */
function glbCast(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, count: number, height = 0.42): Mascot[] {
  return Array.from({ length: count }, () => {
    const obj = cloneSkinned(gltf.scene);
    const box = new THREE.Box3().setFromObject(obj);
    const s = height / Math.max(0.001, box.max.y - box.min.y);
    obj.scale.setScalar(s);
    obj.position.y = -box.min.y * s;
    const root = new THREE.Group();
    root.add(obj);
    const mixer = new THREE.AnimationMixer(obj);
    const find = (...names: string[]) => gltf.animations.find((a) => names.some((n) => a.name.toLowerCase().includes(n))) ?? gltf.animations[0];
    const actions = {
      run: find("run", "walk"),
      idle: find("idle", "breath", "stand"),
      wave: find("wave", "hello", "greet"),
    };
    let current: THREE.AnimationAction | null = null;
    return {
      root,
      pose(f: number, mode: "run" | "idle" | "wave") {
        const clip = actions[mode];
        if (!clip) return;
        const action = mixer.clipAction(clip);
        if (current !== action) {
          current?.stop();
          action.play();
          current = action;
        }
        mixer.setTime(f / FPS); // frame-exact, not wall-clock
      },
    };
  });
}

export function ExplainerTest() {
  const host = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<Style>("ui");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [gltf, setGltf] = useState<{ scene: THREE.Object3D; animations: THREE.AnimationClip[]; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = style === "ui" ? UI_FRAMES : TYPE_FRAMES;
  const frameRef = useRef(0);
  frameRef.current = frame;

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const bg = new Background();
    const shot =
      style === "ui"
        ? buildUiScene(bg)
        : buildTypeScene(bg, gltf ? () => glbCast(gltf, 3) : undefined);

    const resize = () => {
      const w = el.clientWidth;
      const h = Math.round((w * 9) / 16);
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      shot.camera.aspect = 16 / 9;
      shot.camera.updateProjectionMatrix();
      bg.size(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let raf = 0;
    const draw = () => {
      shot.update(frameRef.current); // sets this frame's transforms and the section tint
      renderer.clear();
      renderer.render(bg.scene, bg.camera);
      renderer.clearDepth();
      renderer.render(shot.scene, shot.camera);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    (window as unknown as { __explainer: unknown }).__explainer = { renderer, frames: style === "ui" ? UI_FRAMES : TYPE_FRAMES };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [style, gltf]);

  // Playback at 24 fps, looping.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      acc += (now - last) / 1000;
      last = now;
      const step = Math.floor(acc * FPS);
      if (step > 0) {
        acc -= step / FPS;
        setFrame((f) => (f + step) % total);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const loadGlb = async (file: File) => {
    setError(null);
    try {
      const url = URL.createObjectURL(file);
      const g = await new GLTFLoader().loadAsync(url);
      URL.revokeObjectURL(url);
      setGltf({ scene: g.scene, animations: g.animations, name: file.name });
      setStyle("type");
      setFrame(0);
    } catch (e) {
      setError(`Could not load ${file.name}: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  };

  return (
    <div className="xp">
      <header className="xp-bar">
        <strong>Explainer template · test bench</strong>
        <div className="tb-segment" role="radiogroup" aria-label="Scene style">
          {(
            [
              ["ui", "UI walkthrough · 3D cursors"],
              ["type", "Kinetic type · mascots"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} className="tb-btn" role="radio" aria-checked={style === v} data-active={style === v || undefined} onClick={() => (setStyle(v), setFrame(0))}>
              <span className="tb-label">{l}</span>
            </button>
          ))}
        </div>
        <label className="btn btn--sm xp-file">
          {gltf ? `Cast: ${gltf.name}` : "Load Tripo GLB…"}
          <input type="file" accept=".glb,.gltf,model/gltf-binary" hidden onChange={(e) => e.target.files?.[0] && loadGlb(e.target.files[0])} />
        </label>
        <a className="link-btn" href="./">
          Back to studio
        </a>
      </header>
      {error && <p className="form-error">{error}</p>}
      <div ref={host} className="xp-stage" />
      <div className="xp-controls">
        <button className="btn btn--sm" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={total - 1}
          value={frame}
          aria-label="Frame"
          onChange={(e) => {
            setPlaying(false);
            setFrame(Number(e.target.value));
          }}
        />
        <span className="xp-clock">
          f {frame} / {total - 1} · {(frame / FPS).toFixed(2)} s
        </span>
      </div>
    </div>
  );
}
