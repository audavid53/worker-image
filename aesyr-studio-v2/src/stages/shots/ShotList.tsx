import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Copy, DotsSixVertical, FilmStrip, Plus, Trash } from "@phosphor-icons/react";
import { narrativeById } from "../../../shared/narratives";
import { splitScenes } from "../../../shared/screenplay";
import { CAMERA_ANGLES, CAMERA_MOVES, SHOT_SIZES, SHOT_STATUSES, SHOT_VIEWS, type Shot } from "../../../shared/shots";
import { useProject } from "../../data/project";
import { fmtTime, shotTimings } from "../../data/shot-ops";
import { CastPicker } from "./CastPicker";
import { ShotThumb } from "./ShotThumb";

function PillSelect<T extends string>({
  value,
  options,
  tone,
  label,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[] | readonly T[];
  tone: string;
  label: string;
  onChange: (v: T) => void;
}) {
  const opts = (options as readonly (T | { value: T; label: string })[]).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <select className="pill-select" style={{ ["--pill" as string]: `var(--pill-${tone})` }} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

type DropHint = { id: string; where: "before" | "after" } | { scene: string } | null;

export function ShotList() {
  const p = useProject();
  const { meta, script, shots, characters, environments, sceneMeta } = p.state;
  const [dragId, setDragId] = useState<string | null>(null);
  const [hint, setHint] = useState<DropHint>(null);

  const scenes = useMemo(() => splitScenes(script), [script]);
  const timings = useMemo(() => shotTimings(script, shots), [script, shots]);
  const wps = (meta && narrativeById(meta.narrativeId)?.pace?.words_per_s) ?? 2.5;

  if (!meta || !script.length) {
    return (
      <div className="page empty-state">
        <h2>No script yet</h2>
        <p>Write or paste the script in Script & Cast first.</p>
      </div>
    );
  }

  const total = shots.reduce((s, x) => (scenes.some((sc) => sc.id === x.sceneId) ? s + x.durationS : s), 0);
  const scenesWithout = scenes.filter((sc) => !shots.some((s) => s.sceneId === sc.id)).length;

  // Pointer-based reordering (works with mouse, pen and touch; native HTML drag-and-drop doesn't on touch).
  const hintAt = (clientX: number, clientY: number): DropHint => {
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-shot-id],[data-scene-id]");
    if (!el) return null;
    if (el.dataset.sceneId) return { scene: el.dataset.sceneId };
    if (el.dataset.shotId === dragId) return null;
    const r = el.getBoundingClientRect();
    return { id: el.dataset.shotId!, where: clientY < r.top + r.height / 2 ? "before" : "after" };
  };

  const applyDrop = (id: string, h: DropHint) => {
    if (!h) return;
    if ("scene" in h) {
      const first = shots.find((s) => s.sceneId === h.scene && s.id !== id);
      p.moveShot(id, h.scene, first?.id ?? null);
      return;
    }
    const target = shots.find((s) => s.id === h.id);
    if (!target) return;
    const inScene = shots.filter((s) => s.sceneId === target.sceneId && s.id !== id);
    const before = h.where === "before" ? target.id : (inScene[inScene.findIndex((s) => s.id === target.id) + 1]?.id ?? null);
    p.moveShot(id, target.sceneId, before);
  };

  const handleProps = (shot: Shot) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragId(shot.id);
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      if (dragId === shot.id) setHint(hintAt(e.clientX, e.clientY));
    },
    onPointerUp: () => {
      if (dragId === shot.id) applyDrop(shot.id, hint);
      setDragId(null);
      setHint(null);
    },
    onPointerCancel: () => {
      setDragId(null);
      setHint(null);
    },
    // Keyboard: arrow keys move the shot within its scene.
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const inScene = shots.filter((s) => s.sceneId === shot.sceneId);
      const i = inScene.findIndex((s) => s.id === shot.id);
      if (e.key === "ArrowUp" && i > 0) p.moveShot(shot.id, shot.sceneId, inScene[i - 1].id);
      if (e.key === "ArrowDown" && i < inScene.length - 1) p.moveShot(shot.id, shot.sceneId, inScene[i + 2]?.id ?? null);
    },
  });

  return (
    <div className="shot-list">
      <div className="script-toolbar">
        <FilmStrip size={15} aria-hidden />
        <strong className="shots-title">Shot list</strong>
        <span className="script-count">
          {shots.length} shots · {fmtTime(total)} of {fmtTime(meta.runtimeSeconds)}
        </span>
        <span className="status-spacer" />
        {scenesWithout > 0 && (
          <button className="btn btn--sm btn--primary" onClick={() => p.draftShotsFromScript(wps)} title="Establishing wide, a shot per speech, a shot per action beat">
            Draft shots for {scenesWithout} scene{scenesWithout > 1 ? "s" : ""}
          </button>
        )}
      </div>

      <div className="table-scroll">
        <table className="shot-table">
          <thead>
            <tr>
              <th aria-label="Reorder" />
              <th>#</th>
              <th>Time</th>
              <th>Shot</th>
              <th>Casting</th>
              <th>Location</th>
              <th>Size</th>
              <th>View</th>
              <th>Angle</th>
              <th>Movement</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          {scenes.map((scene) => {
            const mine = shots.filter((s) => s.sceneId === scene.id);
            const color = sceneMeta[scene.id]?.color ?? 1;
            const sceneDur = mine.reduce((s, x) => s + x.durationS, 0);
            return (
              <tbody key={scene.id} style={{ ["--beat" as string]: `var(--beat-${color})` }}>
                <tr className="scene-row" data-scene-id={scene.id} data-drop={hint && "scene" in hint && hint.scene === scene.id ? "" : undefined}>
                  <td colSpan={12}>
                    <span className="sp-num">{scene.index + 1}</span>
                    <strong>{scene.heading.text || "Untitled scene"}</strong>
                    <span className="muted">
                      {mine.length} shot{mine.length === 1 ? "" : "s"} · {fmtTime(sceneDur)}
                    </span>
                    <button className="btn btn--sm" onClick={() => p.addShot(scene.id)}>
                      <Plus size={12} aria-hidden /> Shot
                    </button>
                  </td>
                </tr>
                {mine.map((shot) => {
                  const t = timings[shot.id];
                  return (
                    <tr
                      key={shot.id}
                      className="shot-row"
                      data-shot-id={shot.id}
                      data-dragging={dragId === shot.id || undefined}
                      data-drop={hint && "id" in hint && hint.id === shot.id ? hint.where : undefined}
                    >
                      <td>
                        <button className="drag-handle" title="Drag to reorder · ↑/↓ to move" aria-label={`Reorder shot ${t?.number}`} {...handleProps(shot)}>
                          <DotsSixVertical size={14} aria-hidden />
                        </button>
                      </td>
                      <td className="shot-num">{t?.number}</td>
                      <td className="shot-time">
                        <span>{fmtTime(t?.start ?? 0)}</span>
                        <label>
                          <input
                            type="number"
                            min={0.5}
                            max={600}
                            step={0.5}
                            value={Math.round(shot.durationS * 100) / 100}
                            aria-label={`Shot ${t?.number} duration in seconds`}
                            onChange={(e) => p.updateShot(shot.id, { durationS: Math.max(0.5, Number(e.target.value) || 0.5) })}
                          />
                          s
                        </label>
                      </td>
                      <td className="shot-main">
                        <ShotThumb shot={shot} />
                        <div>
                          <input className="shot-title" value={shot.title} aria-label="Shot title" onChange={(e) => p.updateShot(shot.id, { title: e.target.value })} />
                          <textarea
                            className="shot-desc"
                            rows={2}
                            value={shot.description}
                            placeholder="What the camera sees"
                            aria-label="Shot description"
                            onChange={(e) => p.updateShot(shot.id, { description: e.target.value })}
                          />
                        </div>
                      </td>
                      <td>
                        <CastPicker characters={characters} value={shot.castIds} onChange={(castIds) => p.updateShot(shot.id, { castIds })} />
                      </td>
                      <td>
                        <select
                          className="pill-select"
                          style={{ ["--pill" as string]: "var(--pill-location)" }}
                          aria-label="Location"
                          value={shot.locationId ?? ""}
                          onChange={(e) => p.updateShot(shot.id, { locationId: e.target.value || undefined })}
                        >
                          <option value="">—</option>
                          {environments.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <PillSelect label="Shot size" tone="size" value={shot.size} options={SHOT_SIZES} onChange={(size) => p.updateShot(shot.id, { size })} />
                      </td>
                      <td>
                        <PillSelect label="Shot view" tone="view" value={shot.view} options={SHOT_VIEWS} onChange={(view) => p.updateShot(shot.id, { view })} />
                      </td>
                      <td>
                        <PillSelect label="Camera angle" tone="angle" value={shot.angle} options={CAMERA_ANGLES} onChange={(angle) => p.updateShot(shot.id, { angle })} />
                      </td>
                      <td>
                        <PillSelect label="Camera movement" tone="move" value={shot.movement} options={CAMERA_MOVES} onChange={(movement) => p.updateShot(shot.id, { movement })} />
                      </td>
                      <td>
                        <select className="status-select" data-status={shot.status} aria-label="Status" value={shot.status} onChange={(e) => p.updateShot(shot.id, { status: e.target.value as Shot["status"] })}>
                          {SHOT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s[0].toUpperCase() + s.slice(1)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button title="Duplicate" aria-label={`Duplicate shot ${t?.number}`} onClick={() => p.duplicateShot(shot.id)}>
                            <Copy size={13} />
                          </button>
                          <button title="Delete" aria-label={`Delete shot ${t?.number}`} onClick={() => p.removeShot(shot.id)}>
                            <Trash size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
