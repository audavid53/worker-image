import { useEffect, useMemo, useState } from "react";
import { Books, Copy, FilePlus, FloppyDisk, Trash, X } from "@phosphor-icons/react";
import type { NarrativeStructure, ScenePreset } from "../../shared/library";
import { customId, useLibrary } from "../data/library";
import { NarrativeEditor, withKeys } from "./NarrativeEditor";
import { PresetEditor } from "./PresetEditor";

type Entry = NarrativeStructure | ScenePreset;

const BLANK_NARRATIVE = (): NarrativeStructure => ({
  id: customId("my-structure"),
  name: "My structure",
  blurb: "",
  version: 1,
  source: "custom",
  runtime: { min_s: 30, max_s: 600, default_s: 120 },
  beats: [
    { key: "beginning", act: "Act 1", name: "Beginning", purpose: "", share: 0.25 },
    { key: "middle", act: "Act 2", name: "Middle", purpose: "", share: 0.5 },
    { key: "end", act: "Act 3", name: "End", purpose: "", share: 0.25 },
  ],
  global_rules: [],
});

/** Browse built-in library entries; duplicate, edit, save and delete your own. */
export function LibraryDialog() {
  const lib = useLibrary();
  const { ui } = lib;
  const list: Entry[] = ui.kind === "narrative" ? lib.narratives : lib.presets;
  const selected = list.find((e) => e.id === ui.selected) ?? list[0];
  const [draft, setDraft] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Fresh draft whenever the selection changes.
  useEffect(() => {
    setDraft(selected ? structuredClone(selected) : null);
    setError(null);
    setSaved(false);
  }, [selected?.id, ui.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(
    () => draft !== null && selected !== undefined && draft.id === selected.id && JSON.stringify(draft) !== JSON.stringify(selected),
    [draft, selected],
  );

  useEffect(() => {
    if (!ui.open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  });

  if (!ui.open) return null;

  // The draft resets in an effect, so for one render after a selection/tab change it still holds
  // the previous entry (possibly of the other kind). Only ever edit a draft of the selected entry.
  const current = draft && selected && draft.id === selected.id ? draft : selected;
  const builtin = selected ? lib.isBuiltin(selected.id) : true;

  const guard = () => !dirty || window.confirm("Discard unsaved changes?");
  const close = () => guard() && lib.closeLibrary();
  const pick = (kind: typeof ui.kind, id?: string) => guard() && lib.selectInLibrary(kind, id);

  const duplicate = () => {
    if (!selected || !guard()) return;
    const copy = { ...structuredClone(selected), id: customId(selected.name), name: `${selected.name} (copy)`, source: "custom" as const, version: 1 };
    const err = ui.kind === "narrative" ? lib.saveNarrative(copy) : lib.savePreset(copy);
    if (err) setError(err);
    else lib.selectInLibrary(ui.kind, copy.id);
  };

  const create = () => {
    if (!guard()) return;
    if (ui.kind === "narrative") {
      const n = BLANK_NARRATIVE();
      const err = lib.saveNarrative(n);
      if (err) setError(err);
      else lib.selectInLibrary("narrative", n.id);
    } else duplicate();
  };

  const save = () => {
    if (!draft) return;
    const err = ui.kind === "narrative" ? lib.saveNarrative(withKeys(draft as NarrativeStructure)) : lib.savePreset(draft);
    setError(err);
    setSaved(!err);
  };

  const remove = () => {
    if (!selected || builtin || !window.confirm(`Delete "${selected.name}"? Projects that used it keep their own copy.`)) return;
    lib.remove(ui.kind, selected.id);
    lib.selectInLibrary(ui.kind, undefined);
  };

  const group = (items: Entry[], title: string) =>
    items.length > 0 && (
      <>
        <li className="lib-group">{title}</li>
        {items.map((e) => (
          <li key={e.id}>
            <button className="lib-item" data-active={e.id === selected?.id || undefined} onClick={() => pick(ui.kind, e.id)}>
              <strong>{e.name}</strong>
              <span>
                {"beats" in e ? `${e.beats.length} beats` : (e as ScenePreset).family.replace("_", " ")}
                {"status" in e && (e as ScenePreset).status === "draft" && <em className="badge">draft</em>}
              </span>
            </button>
          </li>
        ))}
      </>
    );

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal lib-modal" role="dialog" aria-label="Library" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <Books size={16} aria-hidden />
          <h2>Library</h2>
          <div className="tb-segment" role="tablist">
            <button className="tb-btn" role="tab" aria-selected={ui.kind === "narrative"} data-active={ui.kind === "narrative" || undefined} onClick={() => pick("narrative")}>
              <span className="tb-label">Story structures</span>
            </button>
            <button className="tb-btn" role="tab" aria-selected={ui.kind === "scene_preset"} data-active={ui.kind === "scene_preset" || undefined} onClick={() => pick("scene_preset")}>
              <span className="tb-label">Scene presets</span>
            </button>
          </div>
          <button aria-label="Close library" onClick={close}>
            <X size={15} />
          </button>
        </header>

        <div className="lib-body">
          <aside className="lib-list">
            <ul>
              {group(
                list.filter((e) => lib.isBuiltin(e.id)),
                "Built-in",
              )}
              {group(
                list.filter((e) => !lib.isBuiltin(e.id)),
                "Yours",
              )}
            </ul>
            <button className="btn btn--sm" onClick={create}>
              <FilePlus size={13} aria-hidden /> {ui.kind === "narrative" ? "New structure" : "New from selected"}
            </button>
          </aside>

          <section className="lib-detail">
            {selected && current && (
              <>
                <div className="lib-detail-head">
                  <div>
                    <h3>{selected.name}</h3>
                    <p>{selected.blurb}</p>
                  </div>
                  <span className="badge">{builtin ? "Built-in · read-only" : "Yours"}</span>
                  {"status" in selected && selected.status === "draft" && (
                    <span className="badge badge--warn" title="Numbers are provisional until measured from references">
                      Draft numbers
                    </span>
                  )}
                </div>
                {"beats" in current ? (
                  <NarrativeEditor value={current} readOnly={builtin} onChange={(n) => (setDraft(n), setSaved(false))} />
                ) : (
                  <PresetEditor value={current} readOnly={builtin} onChange={(p) => (setDraft(p), setSaved(false))} />
                )}
              </>
            )}
          </section>
        </div>

        <footer className="lib-foot">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {saved && !error && <p className="lib-saved">Saved</p>}
          <span className="status-spacer" />
          <button className="btn btn--sm" onClick={duplicate} disabled={!selected}>
            <Copy size={13} aria-hidden /> {builtin ? "Duplicate to edit" : "Duplicate"}
          </button>
          {!builtin && (
            <>
              <button className="btn btn--sm" onClick={remove}>
                <Trash size={13} aria-hidden /> Delete
              </button>
              <button className="btn btn--sm" disabled={!dirty} onClick={() => selected && setDraft(structuredClone(selected))}>
                Revert
              </button>
              <button className="btn btn--sm btn--primary" disabled={!dirty} onClick={save}>
                <FloppyDisk size={13} aria-hidden /> Save
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
