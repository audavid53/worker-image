import { useState, type FormEvent } from "react";
import { Books, CircleNotch, MagicWand, PencilSimpleLine } from "@phosphor-icons/react";
import { CUSTOM_NARRATIVE_ID } from "../../shared/narratives";
import { ASPECT_RATIOS, type StoryResponse } from "../../shared/story";
import { useLibrary } from "../data/library";
import { draftToState, useProject } from "../data/project";

interface Props {
  /** Called after a successful generation; the app approves Idea and opens Story. */
  onGenerated: () => void;
}

export function IdeaStage({ onGenerated }: Props) {
  const { state, replace } = useProject();
  const lib = useLibrary();
  const m = state.meta;
  const [name, setName] = useState(m?.name ?? "");
  const [aspect, setAspect] = useState(m?.aspectRatio ?? "16:9");
  const [narrativeId, setNarrativeId] = useState(m?.narrativeId ?? lib.narratives[0].id);
  const [presetId, setPresetId] = useState(m?.scenePresetId ?? lib.presets[0].id);
  const [runtime, setRuntime] = useState(m?.runtimeSeconds ?? lib.narratives[0].runtime.default_s);
  const [idea, setIdea] = useState(m?.idea ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A project made with a since-deleted user entry still has its snapshot.
  const template = lib.narrative(narrativeId) ?? (m?.narrative?.id === narrativeId ? m.narrative : undefined);
  const preset = lib.preset(presetId) ?? (m?.scenePreset?.id === presetId ? m.scenePreset : undefined);

  const pickTemplate = (id: string) => {
    setNarrativeId(id);
    const t = lib.narrative(id);
    if (t) setRuntime(t.runtime.default_s);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state.meta && !window.confirm("Generating again replaces the current story outline and character bios. Continue?")) return;
    setBusy(true);
    setError(null);
    const body = {
      projectName: name.trim() || "Untitled film",
      aspectRatio: aspect,
      narrativeId,
      scenePresetId: presetId,
      runtimeSeconds: runtime,
      idea,
      // Built-ins are known to the server by id; the user's own structures travel with the request.
      narrative: template && !lib.isBuiltin(template.id) ? template : undefined,
    };
    try {
      const res = await fetch("/api/story", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      const out = json as StoryResponse;
      replace(
        draftToState(
          {
            name: body.projectName,
            aspectRatio: aspect,
            narrativeId,
            scenePresetId: presetId,
            runtimeSeconds: runtime,
            idea,
            logline: "",
            generatedBy: out.source,
            narrative: template,
            scenePreset: preset,
          },
          out.draft,
        ),
      );
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Story generation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="idea-wrap">
      <form className="idea-card" onSubmit={submit}>
        <h1>Start a project</h1>

        <label className="field">
          <span>Project name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled film" maxLength={120} />
        </label>

        <fieldset className="field">
          <legend>Aspect ratio</legend>
          <div className="aspect-row">
            {ASPECT_RATIOS.map((a) => {
              const [w, h] = a.split(":").map(Number);
              return (
                <button
                  type="button"
                  key={a}
                  className="aspect"
                  data-active={aspect === a || undefined}
                  aria-pressed={aspect === a}
                  onClick={() => setAspect(a)}
                >
                  <span className="aspect-box" style={{ aspectRatio: `${w} / ${h}` }} />
                  {a}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="legend-row">
            Story structure
            <button type="button" className="link-btn" onClick={() => lib.openLibrary("narrative", narrativeId)}>
              <Books size={13} aria-hidden /> Library
            </button>
          </legend>
          <div className="template-grid">
            {lib.narratives.map((n) => (
              <button
                type="button"
                key={n.id}
                className="template-card"
                data-active={narrativeId === n.id || undefined}
                aria-pressed={narrativeId === n.id}
                onClick={() => pickTemplate(n.id)}
              >
                <strong>{n.name}</strong>
                <span>{n.blurb}</span>
                <em>
                  {n.beats.length} beats{lib.isBuiltin(n.id) ? "" : " · yours"}
                </em>
              </button>
            ))}
            <button
              type="button"
              className="template-card template-card--custom"
              data-active={narrativeId === CUSTOM_NARRATIVE_ID || undefined}
              aria-pressed={narrativeId === CUSTOM_NARRATIVE_ID}
              onClick={() => pickTemplate(CUSTOM_NARRATIVE_ID)}
            >
              <strong>
                <PencilSimpleLine size={14} aria-hidden /> Create my own
              </strong>
              <span>AI designs a structure for your idea.</span>
            </button>
          </div>
        </fieldset>

        <div className="field-row">
          <label className="field">
            <span>Target length (seconds)</span>
            <input
              type="number"
              min={template?.runtime.min_s ?? 10}
              max={template?.runtime.max_s ?? 7200}
              value={runtime}
              onChange={(e) => setRuntime(Math.round(Number(e.target.value) || 0))}
              required
            />
          </label>
          <fieldset className="field">
            <legend className="legend-row">
              Scene style
              <button type="button" className="link-btn" onClick={() => lib.openLibrary("scene_preset", presetId)}>
                <Books size={13} aria-hidden /> Library
              </button>
            </legend>
            <div className="template-row">
              {lib.presets.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className="pill"
                  title={`${p.blurb}${p.status === "draft" ? " (draft numbers)" : ""}`}
                  data-active={presetId === p.id || undefined}
                  aria-pressed={presetId === p.id}
                  onClick={() => setPresetId(p.id)}
                >
                  {p.name}
                  {p.status === "draft" && <em className="pill-badge">draft</em>}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <label className="field">
          <span>Your idea or script</span>
          <textarea
            rows={6}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="Describe your idea, or paste a script…"
            required
          />
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="idea-actions">
          <button type="submit" className="btn btn--primary" disabled={busy || !idea.trim()}>
            {busy ? <CircleNotch size={15} className="spin" aria-hidden /> : <MagicWand size={15} aria-hidden />}
            {busy ? "Generating…" : state.meta ? "Generate again" : "Generate story"}
          </button>
        </div>
      </form>
    </div>
  );
}
