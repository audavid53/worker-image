import { useCallback, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { ViewMode } from "../stages";

const MIN = 0.2;
const MAX = 0.8;
const clamp = (x: number) => Math.min(MAX, Math.max(MIN, x));

interface Props {
  view: ViewMode;
  /** Fraction of the width given to panel A in split view. */
  split: number;
  onSplit: (f: number) => void;
  a: ReactNode;
  b: ReactNode;
  aLabel: string;
}

/** Panel A (structured) and panel B (canvas): A only, B only, or side by side with a draggable divider. */
export function Workspace({ view, split, onSplit, a, b, aLabel }: Props) {
  const root = useRef<HTMLDivElement>(null);

  const fromPointer = useCallback(
    (clientX: number) => {
      const r = root.current?.getBoundingClientRect();
      if (r && r.width > 0) onSplit(clamp((clientX - r.left) / r.width));
    },
    [onSplit],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    root.current?.setAttribute("data-resizing", "");
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e.clientX);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    root.current?.removeAttribute("data-resizing");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === "ArrowLeft") onSplit(clamp(split - step));
    else if (e.key === "ArrowRight") onSplit(clamp(split + step));
    else if (e.key === "Home") onSplit(MIN);
    else if (e.key === "End") onSplit(MAX);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={root}
      className="workspace"
      data-view={view}
      style={{ ["--split" as string]: `${split * 100}%` }}
    >
      {view !== "b" && <section className="pane pane-a">{a}</section>}
      {view === "split" && (
        <div
          className="split-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${aLabel}`}
          aria-valuemin={MIN * 100}
          aria-valuemax={MAX * 100}
          aria-valuenow={Math.round(split * 100)}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => onSplit(0.5)}
          onKeyDown={onKeyDown}
        />
      )}
      {view !== "a" && <section className="pane pane-b">{b}</section>}
    </div>
  );
}
