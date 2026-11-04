// Pan / zoom / card-drag behaviour shared by the free-form canvases (Story bios, Casting).
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.6;

type Drag =
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }
  | { kind: "card"; id: string; startX: number; startY: number; x: number; y: number };

interface Options {
  /** Current world position of a draggable card. */
  positionOf: (id: string) => { x: number; y: number } | undefined;
  onMove: (id: string, x: number, y: number) => void;
  /** Re-attach the wheel listener when the viewport element changes (e.g. after an empty state). */
  deps?: unknown[];
}

/**
 * Cards mark their drag handle with `data-drag-card={id}`. Buttons and fields inside a handle keep
 * their own clicks: capturing the pointer would retarget the click to the canvas.
 */
export function useBoard({ positionOf, onMove, deps = [] }: Options) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const drag = useRef<Drag | null>(null);
  const viewport = useRef<HTMLDivElement>(null);

  // Ctrl/⌘ + wheel zooms around the pointer; plain wheel pans.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("textarea")) return; // let long fields scroll
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        setZoom((z) => {
          const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * Math.exp(-e.deltaY * 0.002)));
          setPan((pp) => ({ x: px - ((px - pp.x) * nz) / z, y: py - ((py - pp.y) * nz) / z }));
          return nz;
        });
      } else {
        setPan((pp) => ({ x: pp.x - e.deltaX, y: pp.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a")) return;
    const handle = target.closest<HTMLElement>("[data-drag-card]");
    if (handle) {
      const id = handle.dataset.dragCard!;
      const pos = positionOf(id);
      if (!pos) return;
      drag.current = { kind: "card", id, startX: e.clientX, startY: e.clientY, x: pos.x, y: pos.y };
    } else if (target === e.currentTarget || target.classList.contains("canvas-layer")) {
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    } else return;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.kind === "pan") setPan({ x: d.panX + dx, y: d.panY + dy });
    else onMove(d.id, Math.round(d.x + dx / zoom), Math.round(d.y + dy / zoom));
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const zoomBy = (f: number) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * f)));
  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  /** World point at a fraction of the visible viewport (for placing new cards). */
  const worldAt = (fx: number, fy: number) => {
    const r = viewport.current?.getBoundingClientRect();
    return r ? { x: Math.round((r.width * fx - pan.x) / zoom), y: Math.round((r.height * fy - pan.y) / zoom) } : { x: 40, y: 60 };
  };

  return {
    viewport,
    pan,
    zoom,
    zoomBy,
    reset,
    worldAt,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    viewportStyle: { backgroundPosition: `${pan.x}px ${pan.y}px`, backgroundSize: `${20 * zoom}px ${20 * zoom}px` },
    layerStyle: { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` },
  };
}
