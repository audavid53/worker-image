import { useMemo, useState } from "react";
import { ArrowsClockwise, CircleNotch, ClipboardText, FilePlus, MagicWand, Rows, SquaresFour } from "@phosphor-icons/react";
import { CREDIT_COST, type ScriptDraft } from "../../../shared/casting";
import { looksLikeScreenplay, parseScreenplay, splitScenes, type ElementType } from "../../../shared/screenplay";
import { newId, useProject } from "../../data/project";
import { castLinks, scriptFromDraft } from "../../data/script-ops";
import { useStoredState } from "../../useStoredState";
import { BeatBoard } from "./BeatBoard";
import { ScriptEditor, TYPE_LABEL } from "./ScriptEditor";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export function ScriptPanel() {
  const p = useProject();
  const { meta, script, beats, characters, environments } = p.state;
  const [mode, setMode] = useStoredState<"script" | "board">("scriptMode", "script");
  const [focusScene, setFocusScene] = useState<string | null>(null);
  const [focusType, setFocusType] = useState<ElementType | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const links = useMemo(() => castLinks(script, characters, environments), [script, characters, environments]);
  const scenes = useMemo(() => splitScenes(script), [script]);

  if (!meta) {
    return (
      <div className="page empty-state">
        <h2>No project yet</h2>
        <p>Start from the Idea stage.</p>
      </div>
    );
  }

  const importText = (text: string) => {
    if (script.length && !window.confirm("Replace the current script?")) return;
    p.setScript(parseScreenplay(text, newId));
    setPasting(false);
    setPasteText("");
  };

  const writeFromOutline = async () => {
    if (script.length && !window.confirm("Replace the current script with a new draft from the outline?")) return;
    setBusy(true);
    setError(null);
    try {
      const { draft } = await postJson<{ draft: ScriptDraft }>("/api/script", {
        projectName: meta.name || "Untitled film",
        narrativeId: meta.narrativeId,
        runtimeSeconds: meta.runtimeSeconds,
        logline: meta.logline,
        beats: beats.map((b) => ({ key: b.key, name: b.name, summary: b.summary, targetSeconds: b.targetSeconds })),
        characters: characters.map((c) => ({ name: c.name, description: [c.role, c.description].filter(Boolean).join(". ") })),
      });
      const { script: next, sceneMeta } = scriptFromDraft(draft, beats, newId);
      p.setScript(next, sceneMeta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Script generation failed");
    } finally {
      setBusy(false);
    }
  };

  const ideaIsScript = looksLikeScreenplay(meta.idea);

  const pasteBox = pasting && (
    <div className="paste-box">
      <textarea
        rows={10}
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        placeholder={"INT. LOCATION - DAY\n\nAction…\n\nCHARACTER\nDialogue…"}
        aria-label="Paste a screenplay"
        autoFocus
      />
      <div className="paste-actions">
        <button className="btn" onClick={() => setPasting(false)}>
          Cancel
        </button>
        <button className="btn btn--primary" disabled={!pasteText.trim()} onClick={() => importText(pasteText)}>
          Split into scenes
        </button>
      </div>
    </div>
  );

  if (!script.length) {
    return (
      <div className="page script-start">
        <header className="pane-head">
          <h2>Script</h2>
          <p>Start the screenplay. Scenes, speakers and locations are broken down automatically.</p>
        </header>
        <div className="start-options">
          <button className="start-option" onClick={writeFromOutline} disabled={busy || !beats.length}>
            {busy ? <CircleNotch size={18} className="spin" aria-hidden /> : <MagicWand size={18} aria-hidden />}
            <strong>{busy ? "Writing…" : "Write from the outline"}</strong>
            <span>AI drafts scenes for each beat · ≈{CREDIT_COST.llm_script} credits</span>
          </button>
          {ideaIsScript && (
            <button className="start-option" onClick={() => importText(meta.idea)}>
              <ClipboardText size={18} aria-hidden />
              <strong>Use the script from Idea</strong>
              <span>Split the screenplay you pasted at the start</span>
            </button>
          )}
          <button className="start-option" onClick={() => setPasting(true)}>
            <ClipboardText size={18} aria-hidden />
            <strong>Paste a script</strong>
            <span>Fountain or plain screenplay text</span>
          </button>
          <button className="start-option" onClick={() => p.insertElementAfter(null, "heading", "INT. ")}>
            <FilePlus size={18} aria-hidden />
            <strong>Start blank</strong>
            <span>Type it yourself</span>
          </button>
        </div>
        {pasteBox}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="script-wrap">
      <div className="script-toolbar">
        <div className="tb-segment" role="radiogroup" aria-label="Script view">
          <button className="tb-btn" data-active={mode === "script" || undefined} role="radio" aria-checked={mode === "script"} onClick={() => setMode("script")}>
            <Rows size={14} aria-hidden /> <span className="tb-label">Script</span>
          </button>
          <button className="tb-btn" data-active={mode === "board" || undefined} role="radio" aria-checked={mode === "board"} onClick={() => setMode("board")}>
            <SquaresFour size={14} aria-hidden /> <span className="tb-label">Beat board</span>
          </button>
        </div>
        <span className="script-count">
          {scenes.length} scene{scenes.length === 1 ? "" : "s"}
        </span>
        {focusType && mode === "script" && (
          <span className="script-type" title="Tab changes the line type · Enter adds the next line">
            {TYPE_LABEL[focusType]} · Tab to change
          </span>
        )}
        <span className="status-spacer" />
        {(links.unmatchedCharacters.length > 0 || links.unmatchedLocations.length > 0) && (
          <button className="btn btn--sm" onClick={() => p.syncCastFromScript()} title={[...links.unmatchedCharacters, ...links.unmatchedLocations].join(", ")}>
            <ArrowsClockwise size={13} aria-hidden /> Add {links.unmatchedCharacters.length + links.unmatchedLocations.length} to cast
          </button>
        )}
        <button className="btn btn--sm" onClick={() => setPasting((v) => !v)}>
          <ClipboardText size={13} aria-hidden /> Paste
        </button>
        <button className="btn btn--sm" onClick={writeFromOutline} disabled={busy}>
          {busy ? <CircleNotch size={13} className="spin" aria-hidden /> : <MagicWand size={13} aria-hidden />} Redraft
        </button>
      </div>
      {pasteBox}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {mode === "script" ? (
        <div className="page script-page">
          <ScriptEditor links={links} focusScene={focusScene} onFocusType={setFocusType} />
        </div>
      ) : (
        <BeatBoard
          links={links}
          onOpenScene={(id) => {
            setMode("script");
            setFocusScene(null);
            requestAnimationFrame(() => setFocusScene(id));
          }}
        />
      )}
    </div>
  );
}
