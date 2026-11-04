import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { ArrowsOutCardinal, FilmSlate, MapPin, Minus, Plus, Timer, User } from "@phosphor-icons/react";
import { splitScenes } from "../../../shared/screenplay";
import { SHOT_SIZES, type Shot } from "../../../shared/shots";
import { useBoard } from "../../canvas/useBoard";
import { useProject } from "../../data/project";
import { fmtTime, shotTimings } from "../../data/shot-ops";
import { useStoredState } from "../../useStoredState";
import { SceneTimeline } from "../timeline/SceneTimeline";

// Fixed node geometry so ports can be computed without measuring the DOM.
const CAST_W = 190;
const CAST_H = 44;
const CAST_GAP = 14;
const SCENE_W = 280;
const HEAD_H = 50;
const ROW_H = 32;
const FOOT_H = 38;

type NodeRef = { kind: "character" | "environment"; id: string };
type Link = { from: NodeRef; x1: number; y1: number; x2: number; y2: number };

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
};

export function DirectorCanvas() {
  const p = useProject();
  const { meta, script, shots, characters, environments, directorLayout, sceneMeta } = p.state;
  const [link, setLink] = useState<Link | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  /** Scene whose Director timeline is open (replaces the canvas). */
  const [openScene, setOpenScene] = useStoredState<string | null>("timelineScene", null);
  const linkRef = useRef<Link | null>(null);
  linkRef.current = link;

  const scenes = useMemo(() => splitScenes(script), [script]);
  const timings = useMemo(() => shotTimings(script, shots), [script, shots]);

  const castNodes = useMemo(
    () => [
      ...characters.map((c) => ({ kind: "character" as const, id: c.id, name: c.name })),
      ...environments.map((e) => ({ kind: "environment" as const, id: e.id, name: e.name })),
    ],
    [characters, environments],
  );

  // Default layout: cast column on the left, scenes in three columns to the right.
  const layout = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    castNodes.forEach((n, i) => {
      const gap = n.kind === "environment" ? 24 : 0;
      out[n.id] = directorLayout[n.id] ?? { x: 40, y: 70 + i * (CAST_H + CAST_GAP) + gap };
    });
    const colY = [70, 70, 70];
    scenes.forEach((s, i) => {
      const col = i % 3;
      const h = HEAD_H + shots.filter((x) => x.sceneId === s.id).length * ROW_H + FOOT_H;
      out[s.id] = directorLayout[s.id] ?? { x: 320 + col * (SCENE_W + 40), y: colY[col] };
      colY[col] += h + 30;
    });
    return out;
  }, [castNodes, scenes, shots, directorLayout]);

  const board = useBoard({ positionOf: (id) => layout[id], onMove: (id, x, y) => p.moveDirectorNode(id, x, y), deps: [!!meta && script.length > 0] });

  // Shot input ports, in world coordinates.
  const shotPort = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const s of scenes) {
      const pos = layout[s.id];
      if (!pos) continue;
      shots
        .filter((x) => x.sceneId === s.id)
        .forEach((x, i) => (out[x.id] = { x: pos.x, y: pos.y + HEAD_H + i * ROW_H + ROW_H / 2 }));
    }
    return out;
  }, [scenes, shots, layout]);
  const castPort = (id: string) => {
    const pos = layout[id];
    return pos ? { x: pos.x + CAST_W, y: pos.y + CAST_H / 2 } : null;
  };

  // Link dragging follows the pointer on the window so it works over any node.
  const toWorld = (clientX: number, clientY: number) => {
    const r = board.viewport.current!.getBoundingClientRect();
    return { x: (clientX - r.left - board.pan.x) / board.zoom, y: (clientY - r.top - board.pan.y) / board.zoom };
  };
  const toWorldRef = useRef(toWorld);
  toWorldRef.current = toWorld;

  useEffect(() => {
    if (!link) return;
    const move = (e: PointerEvent) => {
      const w = toWorldRef.current(e.clientX, e.clientY);
      setLink((l) => (l ? { ...l, x2: w.x, y2: w.y } : l));
    };
    const up = (e: PointerEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-shot-port]");
      const l = linkRef.current;
      if (target && l) p.connectCast(target.dataset.shotPort!, l.from);
      setLink(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [link !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!meta || !script.length) {
    return (
      <div className="canvas">
        <div className="canvas-label">
          <h2>Director</h2>
          <p>Write the script first.</p>
        </div>
      </div>
    );
  }

  if (openScene && scenes.some((s) => s.id === openScene)) {
    return <SceneTimeline sceneId={openScene} onClose={() => setOpenScene(null)} />;
  }

  const startLink = (e: RPointerEvent, node: NodeRef) => {
    e.stopPropagation();
    e.preventDefault();
    const port = castPort(node.id)!;
    const w = toWorld(e.clientX, e.clientY);
    setLink({ from: node, x1: port.x, y1: port.y, x2: w.x, y2: w.y });
  };

  const edges: { key: string; shot: Shot; node: NodeRef; path: string }[] = [];
  for (const shot of shots) {
    const to = shotPort[shot.id];
    if (!to) continue;
    const refs: NodeRef[] = [
      ...shot.castIds.map((id) => ({ kind: "character" as const, id })),
      ...(shot.locationId ? [{ kind: "environment" as const, id: shot.locationId }] : []),
    ];
    for (const node of refs) {
      const from = castPort(node.id);
      if (from) edges.push({ key: `${shot.id}-${node.id}`, shot, node, path: curve(from.x, from.y, to.x, to.y) });
    }
  }

  return (
    <div ref={board.viewport} className="canvas board-canvas director" data-linking={link ? "" : undefined} {...board.handlers} style={board.viewportStyle}>
      <div className="canvas-layer" style={board.layerStyle}>
        <svg className="wires" aria-hidden={false}>
          {edges.map((e) => (
            <g key={e.key} className="wire" data-kind={e.node.kind} data-hot={hover === e.node.id || hover === e.shot.id || undefined}>
              <path d={e.path} className="wire-line" />
              <path
                d={e.path}
                className="wire-hit"
                role="button"
                aria-label="Disconnect"
                onClick={() => p.disconnectCast(e.shot.id, e.node)}
              >
                <title>Click to disconnect</title>
              </path>
            </g>
          ))}
          {link && <path className="wire-line wire-temp" d={curve(link.x1, link.y1, link.x2, link.y2)} />}
        </svg>

        {castNodes.map((n) => {
          const pos = layout[n.id];
          const Icon = n.kind === "character" ? User : MapPin;
          return (
            <div
              key={n.id}
              className="cast-node"
              data-kind={n.kind}
              style={{ left: pos.x, top: pos.y, width: CAST_W, height: CAST_H }}
              onPointerEnter={() => setHover(n.id)}
              onPointerLeave={() => setHover(null)}
            >
              <div className="node-handle" data-drag-card={n.id} title="Drag to move">
                <Icon size={14} aria-hidden />
                <span>{n.name}</span>
              </div>
              <span
                className="port port--out"
                role="button"
                tabIndex={0}
                aria-label={`Connect ${n.name} to a shot`}
                title="Drag to a shot"
                onPointerDown={(e) => startLink(e, n)}
              />
            </div>
          );
        })}

        {scenes.map((scene) => {
          const pos = layout[scene.id];
          const mine = shots.filter((s) => s.sceneId === scene.id);
          const dur = mine.reduce((s, x) => s + x.durationS, 0);
          return (
            <section
              key={scene.id}
              className="scene-node"
              style={{ left: pos.x, top: pos.y, width: SCENE_W, ["--beat" as string]: `var(--beat-${sceneMeta[scene.id]?.color ?? 1})` }}
            >
              <header className="scene-node-head" data-drag-card={scene.id} title="Drag to move" style={{ height: HEAD_H }}>
                <ArrowsOutCardinal size={12} aria-hidden className="grip" />
                <span className="sp-num">{scene.index + 1}</span>
                <div>
                  <strong>{scene.heading.text || "Untitled scene"}</strong>
                  <span>
                    {mine.length} shots · {fmtTime(dur)}
                  </span>
                </div>
              </header>
              <ol className="scene-node-shots">
                {mine.map((shot) => (
                  <li
                    key={shot.id}
                    style={{ height: ROW_H }}
                    data-hot={edges.some((e) => e.shot.id === shot.id && e.node.id === hover) || undefined}
                    onPointerEnter={() => setHover(shot.id)}
                    onPointerLeave={() => setHover(null)}
                  >
                    <span className="port port--in" data-shot-port={shot.id} data-armed={link ? "" : undefined} aria-label={`Shot ${timings[shot.id]?.number} input`} />
                    <span className="shot-no">{timings[shot.id]?.number}</span>
                    <select
                      className="node-size"
                      aria-label="Shot size"
                      value={shot.size}
                      onChange={(e) => p.updateShot(shot.id, { size: e.target.value as Shot["size"] })}
                    >
                      {SHOT_SIZES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.value}
                        </option>
                      ))}
                    </select>
                    <input className="node-title" value={shot.title} aria-label="Shot title" onChange={(e) => p.updateShot(shot.id, { title: e.target.value })} />
                    <span className="node-cast" title={`${shot.castIds.length} cast${shot.locationId ? " + location" : ""}`}>
                      {shot.castIds.length}
                      <User size={10} aria-hidden />
                    </span>
                  </li>
                ))}
              </ol>
              <footer className="scene-node-foot" style={{ height: FOOT_H }}>
                <button onClick={() => p.addShot(scene.id)}>
                  <Plus size={12} aria-hidden /> Shot
                </button>
                <button onClick={() => setOpenScene(scene.id)} title="Open this scene's Director timeline" disabled={!mine.length}>
                  <Timer size={12} aria-hidden /> Timeline
                </button>
              </footer>
            </section>
          );
        })}
      </div>

      <div className="canvas-label">
        <h2>
          <FilmSlate size={13} aria-hidden /> Director
        </h2>
        <p>{link ? "Drop on a shot's port" : "Drag from a cast port to a shot · click a wire to disconnect"}</p>
      </div>

      <div className="canvas-tools">
        <button onClick={() => board.zoomBy(1 / 1.2)} title="Zoom out" aria-label="Zoom out">
          <Minus size={14} />
        </button>
        <button onClick={board.reset} title="Reset view" aria-label="Reset view">
          {Math.round(board.zoom * 100)}%
        </button>
        <button onClick={() => board.zoomBy(1.2)} title="Zoom in" aria-label="Zoom in">
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
