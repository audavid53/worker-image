import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  ArrowArcLeft,
  ArrowArcRight,
  ArrowLeft,
  ArrowsInLineHorizontal,
  ArrowsOutLineHorizontal,
  ClosedCaptioning,
  Lock,
  LockOpen,
  Magnet,
  MusicNotesPlus,
  Pause,
  Play,
  Plus,
  Rows,
  SpeakerHigh,
  SpeakerSlash,
  TextAlignLeft,
  Waves,
} from "@phosphor-icons/react";
import { narrativeById } from "../../../shared/narratives";
import { splitScenes, cueName } from "../../../shared/screenplay";
import { TRACK_KINDS, TRACK_LABEL, type Clip, type TrackKind } from "../../../shared/timeline";
import { newId, useProject } from "../../data/project";
import { fmtTime } from "../../data/shot-ops";
import {
  addClip,
  addTrack,
  allClips,
  copyClips,
  deleteClips,
  duration,
  end,
  moveClips,
  paste,
  rollEdit,
  setRange,
  shotClips,
  snap,
  snapCandidates,
  snapDelta,
  splitAt,
  toggleMarker,
  toSrt,
  touching,
  trimClip,
  updateClipProps,
  updateTrack,
  type Clipboard,
  type Work,
} from "../../data/timeline-ops";
import { ShotThumb } from "../shots/ShotThumb";
import { decodeAudio, uploadAudio } from "./audio";
import { Waveform } from "./Waveform";

const LABEL_W = 136;
const RULER_H = 26;
const SNAP_PX = 8;
const CLICK_PX = 3;

type Gesture =
  | { kind: "move"; base: Work; ids: string[]; x0: number; edges: number[]; alt: boolean; single?: string; fromTrack: string; moved: boolean }
  | { kind: "trim"; base: Work; id: string; edge: "left" | "right"; x0: number; edgeT: number; moved: boolean }
  | { kind: "roll"; base: Work; left: string; right: string; x0: number; cutT: number; moved: boolean }
  | { kind: "marquee"; x0: number; y0: number; additive: boolean; before: Set<string> }
  | { kind: "scrub" }
  | { kind: "resize"; base: Work; trackId: string; y0: number; h0: number }
  | { kind: "line"; text: string; speaker?: string };

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.closest("input, textarea, select, [contenteditable=true]") !== null;
};

function tickStep(pps: number) {
  for (const s of [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]) if (s * pps >= 64) return s;
  return 120;
}

export function SceneTimeline({ sceneId, onClose }: { sceneId: string; onClose: () => void }) {
  const p = useProject();
  const { script, shots, timelines, meta, sceneMeta } = p.state;
  const wps = (meta && narrativeById(meta.narrativeId)?.pace?.words_per_s) ?? 2.5;

  useEffect(() => p.ensureTimeline(sceneId, wps), [sceneId]); // eslint-disable-line react-hooks/exhaustive-deps

  const doc = timelines[sceneId];
  const sceneShots = useMemo(() => shots.filter((s) => s.sceneId === sceneId), [shots, sceneId]);
  const work: Work | null = useMemo(() => (doc ? { doc, shots: sceneShots } : null), [doc, sceneShots]);

  const [preview, setPreviewState] = useState<Work | null>(null);
  // Mirrored in a ref so pointer-up commits outside a state updater (updaters may run twice).
  const previewRef = useRef<Work | null>(null);
  const setPreview = (w: Work | null) => {
    previewRef.current = w;
    setPreviewState(w);
  };
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pps, setPps] = useState(60);
  const [snapOn, setSnapOn] = useState(true);
  const [ripple, setRipple] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [linesOpen, setLinesOpen] = useState(true);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const past = useRef<Work[]>([]);
  const future = useRef<Work[]>([]);
  const clipboard = useRef<Clipboard | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const lanes = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const view = preview ?? work;
  const scene = useMemo(() => splitScenes(script).find((s) => s.id === sceneId), [script, sceneId]);
  const total = view ? Math.max(duration(view), 5) : 5;

  // ---------- history ----------
  const commit = useCallback(
    (next: Work) => {
      if (!work) return;
      past.current = [...past.current.slice(-99), work];
      future.current = [];
      p.commitTimeline(sceneId, next);
    },
    [work, p, sceneId],
  );
  const undo = () => {
    const prev = past.current.pop();
    if (!prev || !work) return;
    future.current.push(work);
    p.commitTimeline(sceneId, prev);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next || !work) return;
    past.current.push(work);
    p.commitTimeline(sceneId, next);
  };

  // ---------- coordinates ----------
  const timeAt = (clientX: number) => {
    const el = lanes.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + el.scrollLeft) / pps);
  };
  const trackAt = (clientX: number, clientY: number) =>
    document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-track-id]")?.dataset.trackId;

  // ---------- gestures ----------
  const onLanesDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!work || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, button")) return;
    const clipEl = target.closest<HTMLElement>("[data-clip-id]");
    if (target.closest(".tl-ruler")) {
      gesture.current = { kind: "scrub" };
      setPlayhead(timeAt(e.clientX));
      return;
    }
    if (clipEl) {
      const id = clipEl.dataset.clipId!;
      const c = allClips(work).find((x) => x.id === id);
      if (!c) return;
      const sel = new Set(selection);
      if (e.shiftKey || e.metaKey || e.ctrlKey) sel.has(id) ? sel.delete(id) : sel.add(id);
      else if (!sel.has(id)) {
        sel.clear();
        sel.add(id);
      }
      setSelection(sel);
      const edge = target.closest<HTMLElement>("[data-edge]")?.dataset.edge as "left" | "right" | undefined;
      if (edge) {
        const neighbour = !e.ctrlKey && !e.metaKey ? touching(work, c, edge) : undefined;
        gesture.current = neighbour
          ? { kind: "roll", base: work, left: edge === "right" ? c.id : neighbour.id, right: edge === "right" ? neighbour.id : c.id, x0: e.clientX, cutT: edge === "right" ? end(c) : c.start, moved: false }
          : { kind: "trim", base: work, id: c.id, edge, x0: e.clientX, edgeT: edge === "right" ? end(c) : c.start, moved: false };
      } else {
        const ids = [...sel].filter((x) => allClips(work).some((cc) => cc.id === x));
        const moving = allClips(work).filter((x) => ids.includes(x.id));
        gesture.current = {
          kind: "move",
          base: work,
          ids,
          x0: e.clientX,
          edges: moving.flatMap((x) => [x.start, end(x)]),
          alt: e.altKey,
          single: ids.length === 1 ? ids[0] : undefined,
          fromTrack: c.trackId,
          moved: false,
        };
      }
      return;
    }
    // empty lane: marquee
    const r = lanes.current!.getBoundingClientRect();
    const additive = e.shiftKey;
    gesture.current = { kind: "marquee", x0: e.clientX - r.left + lanes.current!.scrollLeft, y0: e.clientY - r.top + lanes.current!.scrollTop, additive, before: additive ? new Set(selection) : new Set() };
    if (!additive) setSelection(new Set());
  };

  const startResize = (e: RPointerEvent, trackId: string, h0: number) => {
    if (!work) return;
    e.stopPropagation();
    gesture.current = { kind: "resize", base: work, trackId, y0: e.clientY, h0 };
  };

  const startLine = (e: RPointerEvent, text: string, speaker?: string) => {
    e.preventDefault();
    gesture.current = { kind: "line", text, speaker };
    setGhost({ x: e.clientX, y: e.clientY, text });
  };

  const latest = useRef({ work, pps, playhead, snapOn, ripple, selection });
  latest.current = { work, pps, playhead, snapOn, ripple, selection };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || !lanes.current) return;
      const L = latest.current;
      const doSnap = L.snapOn && !e.ctrlKey && !e.metaKey;
      const thr = SNAP_PX / L.pps;
      if (g.kind === "scrub") {
        let t = timeAt(e.clientX);
        if (doSnap && L.work) t = snap(t, snapCandidates(L.work, -1), thr);
        setPlayhead(t);
      } else if (g.kind === "move") {
        if (Math.abs(e.clientX - g.x0) < CLICK_PX && !g.moved && trackAt(e.clientX, e.clientY) === g.fromTrack) return;
        g.moved = true;
        let dt = (e.clientX - g.x0) / L.pps;
        if (doSnap) dt = snapDelta(g.edges, dt, snapCandidates(g.base, L.playhead, new Set(g.ids)), thr);
        const over = trackAt(e.clientX, e.clientY);
        const toTrackId = g.single && over && over !== g.fromTrack ? over : undefined;
        setPreview(moveClips(g.base, g.ids, dt, { toTrackId, duplicate: g.alt, newId }));
      } else if (g.kind === "trim") {
        if (Math.abs(e.clientX - g.x0) < CLICK_PX && !g.moved) return;
        g.moved = true;
        let t = g.edgeT + (e.clientX - g.x0) / L.pps;
        if (doSnap) t = snap(t, snapCandidates(g.base, L.playhead, new Set([g.id])), thr);
        setPreview(trimClip(g.base, g.id, g.edge, t - g.edgeT, { stretch: e.shiftKey, ripple: L.ripple }));
      } else if (g.kind === "roll") {
        if (Math.abs(e.clientX - g.x0) < CLICK_PX && !g.moved) return;
        g.moved = true;
        let t = g.cutT + (e.clientX - g.x0) / L.pps;
        if (doSnap) t = snap(t, snapCandidates(g.base, L.playhead, new Set([g.left, g.right])), thr);
        setPreview(rollEdit(g.base, g.left, g.right, t - g.cutT));
      } else if (g.kind === "marquee") {
        const r = lanes.current.getBoundingClientRect();
        const x1 = e.clientX - r.left + lanes.current.scrollLeft;
        const y1 = e.clientY - r.top + lanes.current.scrollTop;
        const box = { x: Math.min(g.x0, x1), y: Math.min(g.y0, y1), w: Math.abs(x1 - g.x0), h: Math.abs(y1 - g.y0) };
        setMarquee(box);
        const hit = new Set(g.before);
        lanes.current.querySelectorAll<HTMLElement>("[data-clip-id]").forEach((el) => {
          const b = el.getBoundingClientRect();
          const bx = b.left - r.left + lanes.current!.scrollLeft;
          const by = b.top - r.top + lanes.current!.scrollTop;
          if (bx < box.x + box.w && bx + b.width > box.x && by < box.y + box.h && by + b.height > box.y) hit.add(el.dataset.clipId!);
        });
        setSelection(hit);
      } else if (g.kind === "resize") {
        setPreview(updateTrack(g.base, g.trackId, { height: g.h0 + (e.clientY - g.y0) }));
      } else if (g.kind === "line") {
        setGhost((gh) => (gh ? { ...gh, x: e.clientX, y: e.clientY } : gh));
      }
    };
    const up = (e: PointerEvent) => {
      const g = gesture.current;
      gesture.current = null;
      setMarquee(null);
      if (!g) return;
      const L = latest.current;
      if (g.kind === "line") {
        setGhost(null);
        const tid = trackAt(e.clientX, e.clientY);
        const track = L.work?.doc.tracks.find((t) => t.id === tid);
        if (L.work && track && (track.kind === "dialogue" || track.kind === "text") && !track.locked) {
          const len = Math.max(1, Math.round(((g.text.match(/\S+/g)?.length ?? 0) / wps) * 10) / 10);
          let t = timeAt(e.clientX);
          if (L.snapOn) t = snap(t, snapCandidates(L.work, L.playhead), SNAP_PX / L.pps);
          const r = addClip(L.work, track.id, t, len, { text: g.text, speaker: g.speaker }, newId);
          commit(r.work);
          setSelection(new Set([r.id]));
        }
        return;
      }
      const pv = previewRef.current;
      const moved = (g.kind === "move" || g.kind === "trim" || g.kind === "roll") && g.moved;
      if (pv && (moved || g.kind === "resize")) commit(pv);
      setPreview(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [commit, wps]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/⌘ + wheel zooms around the pointer.
  useEffect(() => {
    const el = lanes.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const t = (x + el.scrollLeft) / pps;
      const next = Math.min(400, Math.max(8, pps * Math.exp(-e.deltaY * 0.002)));
      setPps(next);
      requestAnimationFrame(() => (el.scrollLeft = t * next - x));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [pps, !!work]); // eslint-disable-line react-hooks/exhaustive-deps

  const fit = () => {
    const w = lanes.current?.clientWidth ?? 800;
    setPps(Math.min(400, Math.max(8, (w - 40) / total)));
    if (lanes.current) lanes.current.scrollLeft = 0;
  };

  // ---------- playback (with audio clips) ----------
  const audios = useRef(new Map<string, HTMLAudioElement>());
  useEffect(() => {
    if (!playing || !work) {
      audios.current.forEach((a) => a.pause());
      return;
    }
    let raf = 0;
    let last = performance.now();
    const stopAt = work.doc.outPoint ?? duration(work);
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayhead((t) => {
        const nt = t + dt;
        if (nt >= stopAt) {
          setPlaying(false);
          return stopAt;
        }
        const muted = new Set(work.doc.tracks.filter((x) => x.muted).map((x) => x.id));
        for (const c of work.doc.clips) {
          if (!c.props.url || muted.has(c.trackId)) continue;
          let a = audios.current.get(c.id);
          const inside = nt >= c.start && nt < end(c);
          if (inside) {
            if (!a) {
              a = new Audio(c.props.url);
              audios.current.set(c.id, a);
            }
            if (a.paused) {
              a.currentTime = (c.sourceIn ?? 0) + (nt - c.start) * (c.rate ?? 1);
              a.playbackRate = c.rate ?? 1;
              void a.play().catch(() => undefined);
            }
          } else if (a && !a.paused) a.pause();
        }
        return nt;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, work]);
  useEffect(() => () => audios.current.forEach((a) => a.pause()), []);

  const togglePlay = () => {
    if (!work) return;
    if (!playing) {
      const startAt = work.doc.inPoint;
      const stopAt = work.doc.outPoint ?? duration(work);
      if (playhead >= stopAt - 0.01) setPlayhead(startAt ?? 0);
      else if (startAt !== undefined && playhead < startAt) setPlayhead(startAt);
    }
    setPlaying((v) => !v);
  };

  // ---------- commands ----------
  const underPlayhead = () => (work ? allClips(work).filter((c) => playhead > c.start && playhead < end(c)).map((c) => c.id) : []);
  const run = {
    blade: () => work && commit(splitAt(work, selection.size ? [...selection] : underPlayhead(), playhead, newId)),
    copy: () => work && selection.size && (clipboard.current = copyClips(work, [...selection])),
    cut: () => {
      if (!work || !selection.size) return;
      clipboard.current = copyClips(work, [...selection]);
      commit(deleteClips(work, [...selection], ripple));
      setSelection(new Set());
    },
    paste: () => {
      if (!work || !clipboard.current?.clips.length) return;
      const r = paste(work, clipboard.current, playhead, newId);
      commit(r.work);
      setSelection(new Set(r.ids));
    },
    remove: () => {
      if (!work || !selection.size) return;
      commit(deleteClips(work, [...selection], ripple));
      setSelection(new Set());
    },
    marker: () => work && commit(toggleMarker(work, playhead, newId)),
    in: () => work && commit(setRange(work, { inPoint: playhead })),
    out: () => work && commit(setRange(work, { outPoint: playhead })),
    clearRange: () => work && commit(setRange(work, { inPoint: undefined, outPoint: undefined })),
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isTyping(e) || !work) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      } else if (mod) return;
      else if (k === "b") run.blade();
      else if (k === "c") run.copy();
      else if (k === "x") run.cut();
      else if (k === "v") run.paste();
      else if (k === "s") setSnapOn((v) => !v);
      else if (k === "r") setRipple((v) => !v);
      else if (k === "i") run.in();
      else if (k === "o") run.out();
      else if (k === "m") run.marker();
      else if (k === "delete" || k === "backspace") run.remove();
      else if (k === " " || k === "k") {
        e.preventDefault();
        k === " " ? togglePlay() : setPlaying(false);
      } else if (k === "l") !playing && togglePlay();
      else if (k === "j") {
        setPlaying(false);
        setPlayhead((t) => Math.max(0, t - 1));
      } else if (k === "\\") fit();
      else if (k === "escape") setSelection(new Set());
      else if (k === "arrowleft" || k === "arrowright") {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / (work.doc.fps || 24);
        setPlayhead((t) => Math.max(0, t + (k === "arrowleft" ? -step : step)));
      } else return;
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // ---------- audio import ----------
  const importAudio = async (files: FileList | File[], at: number, trackId?: string) => {
    if (!work) return;
    const audioTrack = trackId && work.doc.tracks.find((t) => t.id === trackId && t.kind === "audio") ? trackId : work.doc.tracks.find((t) => t.kind === "audio")?.id;
    if (!audioTrack) return;
    setError(null);
    let w = work;
    const added: string[] = [];
    for (const f of Array.from(files)) {
      try {
        setBusy(`Uploading ${f.name}…`);
        const buf = await f.arrayBuffer();
        const { duration: dur, peaks } = await decodeAudio(buf);
        const url = await uploadAudio(buf);
        const r = addClip(w, audioTrack, at, dur, { url, name: f.name, peaks }, newId, { sourceIn: 0, sourceLength: dur, rate: 1 });
        w = r.work;
        added.push(r.id);
        at = end(w.doc.clips.find((c) => c.id === r.id)!);
      } catch (e) {
        setError(`${f.name}: ${e instanceof Error ? e.message : "could not import"}`);
      }
    }
    setBusy(null);
    if (added.length) {
      commit(w);
      setSelection(new Set(added));
    }
  };

  if (!work || !view || !scene) {
    return (
      <div className="canvas">
        <div className="canvas-label">
          <h2>Timeline</h2>
          <p>Preparing…</p>
        </div>
      </div>
    );
  }

  // ---------- render ----------
  const clips = allClips(view);
  const shotIds = new Set(shotClips(view).map((c) => c.id));
  const contentW = Math.max(total + 10, (lanes.current?.clientWidth ?? 800) / pps) * pps;
  const step = tickStep(pps);
  const ticks: number[] = [];
  for (let t = 0; t <= contentW / pps; t += step) ticks.push(t);
  const nowShot = shotClips(view).find((c) => playhead >= c.start && playhead < end(c));
  const nowLine = view.doc.clips.find((c) => {
    const k = view.doc.tracks.find((t) => t.id === c.trackId)?.kind;
    return (k === "dialogue" || k === "text") && playhead >= c.start && playhead < end(c);
  });
  const sceneLines = scene.elements.flatMap((e, i) => {
    if (e.type === "action") return [{ key: e.id, text: e.text, speaker: undefined as string | undefined }];
    if (e.type !== "character") return [];
    const parts: string[] = [];
    for (let j = i + 1; j < scene.elements.length && ["dialogue", "parenthetical"].includes(scene.elements[j].type); j++) if (scene.elements[j].type === "dialogue") parts.push(scene.elements[j].text);
    return parts.length ? [{ key: e.id, text: parts.join(" "), speaker: cueName(e.text) }] : [];
  });

  const kindIcon: Record<TrackKind, string> = { shot: "▦", camera: "◉", motion: "≋", dialogue: "❝", text: "T", audio: "♪" };

  const renderClip = (c: Clip, kind: TrackKind, height: number) => {
    const shot = shotIds.has(c.id) ? view.shots.find((s) => s.id === c.id) : undefined;
    const w = c.length * pps;
    const label = shot ? shot.title : c.props.speaker ? `${c.props.speaker}: ${c.props.text ?? ""}` : (c.props.text ?? c.props.name ?? "");
    return (
      <div
        key={c.id}
        data-clip-id={c.id}
        className="tl-clip"
        data-kind={kind}
        data-selected={selection.has(c.id) || undefined}
        style={{ left: c.start * pps, width: Math.max(2, w), height: height - 6 }}
        title={`${label}\n${c.start.toFixed(2)}s → ${end(c).toFixed(2)}s${c.rate && c.rate !== 1 ? ` · ${c.rate.toFixed(2)}×` : ""}`}
        onDoubleClick={() => kind !== "audio" && setEditing(c.id)}
      >
        <span className="tl-edge" data-edge="left" />
        {kind === "audio" && c.props.peaks && c.sourceLength ? (
          <Waveform peaks={c.props.peaks} sourceIn={c.sourceIn ?? 0} sourceLength={c.sourceLength} span={c.length * (c.rate ?? 1)} width={Math.max(2, w - 2)} height={height - 8} />
        ) : null}
        {shot && w > 70 && height > 34 && <ShotThumb shot={shot} />}
        {editing === c.id ? (
          <input
            className="tl-edit"
            autoFocus
            defaultValue={shot ? shot.title : (c.props.text ?? "")}
            onBlur={(e) => {
              if (shot) p.updateShot(shot.id, { title: e.target.value });
              else commit(updateClipProps(work, c.id, { text: e.target.value }));
              setEditing(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(null);
            }}
          />
        ) : (
          <span className="tl-label">
            {shot && <b>{shot.size}</b>}
            {kind === "audio" && <Waves size={11} aria-hidden />} {label}
          </span>
        )}
        <span className="tl-edge" data-edge="right" />
      </div>
    );
  };

  return (
    <div className="timeline" onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}>
      <div className="tl-toolbar">
        <button className="btn btn--sm" onClick={onClose} title="Back to the Director canvas">
          <ArrowLeft size={13} aria-hidden /> Director
        </button>
        <span className="sp-num" style={{ ["--beat" as string]: `var(--beat-${sceneMeta[sceneId]?.color ?? 1})` }}>
          {scene.index + 1}
        </span>
        <strong className="tl-title">{scene.heading.text || "Untitled scene"}</strong>
        <button className="tl-icon" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} title="Play/pause (Space · J K L)">
          {playing ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
        </button>
        <span className="tl-clock">
          {fmtTime(playhead)} / {fmtTime(duration(view))}
        </span>
        <span className="status-spacer" />
        <button className="tl-icon" onClick={undo} disabled={!past.current.length} aria-label="Undo" title="Undo (Ctrl+Z)">
          <ArrowArcLeft size={14} />
        </button>
        <button className="tl-icon" onClick={redo} disabled={!future.current.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
          <ArrowArcRight size={14} />
        </button>
        <button className="tl-toggle" data-on={snapOn || undefined} aria-pressed={snapOn} onClick={() => setSnapOn((v) => !v)} title="Snapping (S) · hold Ctrl to bypass">
          <Magnet size={13} aria-hidden /> Snap
        </button>
        <button className="tl-toggle" data-on={ripple || undefined} aria-pressed={ripple} onClick={() => setRipple((v) => !v)} title="Ripple edits (R)">
          <ArrowsOutLineHorizontal size={13} aria-hidden /> Ripple
        </button>
        <button className="tl-icon" onClick={fit} aria-label="Fit scene" title="Fit scene (\)">
          <ArrowsInLineHorizontal size={14} />
        </button>
        <input className="tl-zoom" type="range" min={8} max={400} value={pps} aria-label="Zoom" onChange={(e) => setPps(Number(e.target.value))} />
        <button className="tl-icon" onClick={() => fileInput.current?.click()} aria-label="Import audio" title="Import audio (or drop files on the timeline)">
          <MusicNotesPlus size={15} />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void importAudio(e.target.files, playhead);
            e.target.value = "";
          }}
        />
        <button
          className="tl-icon"
          aria-label="Export captions"
          title="Export dialogue and text as SRT captions"
          onClick={() => {
            const blob = new Blob([toSrt(view)], { type: "application/x-subrip" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `scene-${scene.index + 1}.srt`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          <ClosedCaptioning size={15} />
        </button>
        <button className="tl-toggle" data-on={linesOpen || undefined} aria-pressed={linesOpen} onClick={() => setLinesOpen((v) => !v)} title="Script lines you can drag onto the Dialogue or Text track">
          <TextAlignLeft size={13} aria-hidden /> Lines
        </button>
      </div>

      <div className="tl-preview">
        {nowShot ? <ShotThumb shot={view.shots.find((s) => s.id === nowShot.id)!} /> : <span className="shot-thumb shot-thumb--empty" />}
        <div>
          <strong>
            {nowShot ? (() => {
              const s = view.shots.find((x) => x.id === nowShot.id)!;
              return `${s.size} · ${s.view} · ${s.angle} · ${s.movement} — ${s.title}`;
            })() : "—"}
          </strong>
          <p className="tl-caption">{nowLine ? `${nowLine.props.speaker ? `${nowLine.props.speaker}: ` : ""}${nowLine.props.text}` : " "}</p>
        </div>
        {(busy || error) && <span className={error ? "tl-error" : "tl-busy"}>{error ?? busy}</span>}
      </div>

      <div className="tl-body">
        <div className="tl-labels" style={{ width: LABEL_W }}>
          <div className="tl-labels-head" style={{ height: RULER_H }}>
            <select
              aria-label="Add track"
              value=""
              onChange={(e) => {
                if (e.target.value) commit(addTrack(work, e.target.value as TrackKind, newId));
              }}
            >
              <option value="">+ Track</option>
              {TRACK_KINDS.filter((k) => k !== "shot").map((k) => (
                <option key={k} value={k}>
                  {TRACK_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          {view.doc.tracks.map((t) => (
            <div key={t.id} className="tl-label-row" data-kind={t.kind} data-muted={t.muted || undefined} style={{ height: t.height }}>
              <span className="tl-kind" aria-hidden>
                {kindIcon[t.kind]}
              </span>
              <span className="tl-name">{t.name}</span>
              {t.kind !== "shot" && (
                <button
                  className="tl-mini"
                  aria-label={t.locked ? `Unlock ${t.name}` : `Lock ${t.name}`}
                  title={t.locked ? "Unlock" : "Lock"}
                  onClick={() => commit(updateTrack(work, t.id, { locked: !t.locked }))}
                >
                  {t.locked ? <Lock size={11} /> : <LockOpen size={11} />}
                </button>
              )}
              {(t.kind === "audio" || t.kind === "dialogue" || t.kind === "text") && (
                <button
                  className="tl-mini"
                  aria-label={t.muted ? `Unmute ${t.name}` : `Mute ${t.name}`}
                  title={t.muted ? "Unmute" : "Mute"}
                  onClick={() => commit(updateTrack(work, t.id, { muted: !t.muted }))}
                >
                  {t.muted ? <SpeakerSlash size={11} /> : <SpeakerHigh size={11} />}
                </button>
              )}
              <span className="tl-resize" title="Drag to resize track" onPointerDown={(e) => startResize(e, t.id, t.height)} />
            </div>
          ))}
        </div>

        <div
          ref={lanes}
          className="tl-lanes"
          onPointerDown={onLanesDown}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            void importAudio(e.dataTransfer.files, timeAt(e.clientX), trackAt(e.clientX, e.clientY));
          }}
        >
          <div className="tl-content" style={{ width: contentW }}>
            <div className="tl-ruler" style={{ height: RULER_H }}>
              {view.doc.inPoint !== undefined || view.doc.outPoint !== undefined ? (
                <span
                  className="tl-range"
                  style={{
                    left: (view.doc.inPoint ?? 0) * pps,
                    width: ((view.doc.outPoint ?? duration(view)) - (view.doc.inPoint ?? 0)) * pps,
                  }}
                  title="In/out range (I / O) · double-click to clear"
                  onDoubleClick={run.clearRange}
                />
              ) : null}
              {ticks.map((t) => (
                <span key={t} className="tl-tick" style={{ left: t * pps }}>
                  {fmtTime(t).replace(/\.0$/, "")}
                </span>
              ))}
              {view.doc.markers.map((m) => (
                <span key={m.id} className="tl-marker" style={{ left: m.t * pps }} title={`Marker ${fmtTime(m.t)} (M toggles)`} />
              ))}
            </div>
            {view.doc.tracks.map((t) => (
              <div key={t.id} className="tl-lane" data-track-id={t.id} data-kind={t.kind} data-locked={t.locked || undefined} data-muted={t.muted || undefined} style={{ height: t.height }}>
                {clips.filter((c) => c.trackId === t.id).map((c) => renderClip(c, t.kind, t.height))}
              </div>
            ))}
            {marquee && <div className="tl-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
            <div className="tl-playhead" style={{ left: playhead * pps }} />
          </div>
        </div>

        {linesOpen && (
          <aside className="tl-lines" aria-label="Script lines">
            <h3>
              <Rows size={12} aria-hidden /> Scene lines
            </h3>
            <p className="muted">Drag onto Dialogue or Text</p>
            {sceneLines.map((l) => (
              <div key={l.key} className="tl-line" data-dialogue={l.speaker ? "" : undefined} onPointerDown={(e) => startLine(e, l.text, l.speaker)}>
                {l.speaker && <b>{l.speaker}</b>}
                <span>{l.text}</span>
              </div>
            ))}
            {!sceneLines.length && <p className="muted">No lines in this scene.</p>}
          </aside>
        )}
      </div>

      <div className="tl-help">
        Drag to move · Alt+drag duplicate · drag edges to trim (Shift stretches audio) · edges between touching clips roll (Ctrl trims) · drag empty space to
        select · B blade · C/X/V copy/cut/paste · Del delete · I/O in/out · M marker · S snap · R ripple · \ fit · Ctrl+wheel zoom · Ctrl+Z undo
        <button className="tl-icon" style={{ marginLeft: 8 }} aria-label="Add caption at playhead" title="Add a text clip at the playhead" onClick={() => {
          const tid = work.doc.tracks.find((t) => t.kind === "text")?.id;
          if (!tid) return;
          const r = addClip(work, tid, playhead, 2, { text: "Caption" }, newId);
          commit(r.work);
          setSelection(new Set([r.id]));
          setEditing(r.id);
        }}>
          <Plus size={12} />
        </button>
      </div>

      {ghost && (
        <div className="tl-ghost" style={{ left: ghost.x + 10, top: ghost.y + 10 }}>
          {ghost.text.slice(0, 60)}
        </div>
      )}
    </div>
  );
}
