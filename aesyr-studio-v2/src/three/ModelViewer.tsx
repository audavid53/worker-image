import { useEffect, useRef } from "react";
import * as THREE from "three";
import { X } from "@phosphor-icons/react";
import type { Code3DSpec } from "../../shared/casting";
import { buildModel, disposeModel, placeCamera, stage, STUDIO_BG } from "./primitives";

/** Modal orbit viewer for a code-3D model. Drag to orbit, wheel to zoom, Esc to close. */
export function ModelViewer({ spec, title, onClose }: { spec: Code3DSpec; title: string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(STUDIO_BG);
    el.appendChild(renderer.domElement);

    const model = buildModel(spec);
    const s = stage(model, 1);
    let yaw = 0.6;
    let pitch = 0.2;
    let dist = s.dist;
    let raf = 0;

    const render = () => {
      placeCamera(s.camera, s.centre, dist, yaw, pitch);
      renderer.render(s.scene, s.camera);
    };
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(width, height, false);
      s.camera.aspect = width / Math.max(1, height);
      s.camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let dragging: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      dragging = { x: e.clientX, y: e.clientY };
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      yaw -= (e.clientX - dragging.x) * 0.01;
      pitch = Math.min(1.4, Math.max(-0.2, pitch + (e.clientY - dragging.y) * 0.01));
      dragging = { x: e.clientX, y: e.clientY };
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(render);
    };
    const up = () => (dragging = null);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      dist = Math.min(s.dist * 4, Math.max(s.dist * 0.3, dist * Math.exp(e.deltaY * 0.001)));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(render);
    };
    const c = renderer.domElement;
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("wheel", wheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("wheel", wheel);
      disposeModel(model);
      renderer.dispose();
      c.remove();
    };
  }, [spec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal model-modal" role="dialog" aria-label={`${title} 3D model`} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <span>{spec.parts.length} parts · {spec.height_m.toFixed(2)} m</span>
          <button aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </header>
        <div ref={host} className="model-host" />
        <p className="modal-hint">Drag to orbit · wheel to zoom · Esc to close</p>
      </div>
    </div>
  );
}
