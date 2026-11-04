import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { MapPin, Trash, User } from "@phosphor-icons/react";
import { TAB_CYCLE, splitScenes, type ElementType, type ScriptElement } from "../../../shared/screenplay";
import { useProject } from "../../data/project";
import type { CastLinks } from "../../data/script-ops";

const TYPE_LABEL: Record<ElementType, string> = {
  heading: "Scene heading",
  action: "Action",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  transition: "Transition",
};

const PLACEHOLDER: Partial<Record<ElementType, string>> = {
  heading: "INT. LOCATION - DAY",
  action: "What we see…",
  character: "NAME",
  parenthetical: "(beat)",
  dialogue: "Line…",
  transition: "CUT TO:",
};

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

interface Props {
  links: CastLinks;
  /** Scene to scroll into view (set by the beat board). */
  focusScene: string | null;
  onFocusType: (t: ElementType | null) => void;
}

export function ScriptEditor({ links, focusScene, onFocusType }: Props) {
  const p = useProject();
  const { script, sceneMeta, beats, characters, environments } = p.state;
  const pendingFocus = useRef<{ id: string; at: "start" | "end" } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Focus an element created/removed by the last keystroke once it is rendered.
  useLayoutEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    const el = root.current?.querySelector<HTMLTextAreaElement>(`textarea[data-id="${f.id}"]`);
    if (el) {
      el.focus();
      const pos = f.at === "end" ? el.value.length : 0;
      el.setSelectionRange(pos, pos);
      pendingFocus.current = null;
    }
  });

  useEffect(() => {
    if (focusScene) root.current?.querySelector(`[data-scene="${focusScene}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusScene]);

  const ids = script.map((e) => e.id);

  /** Focus an element that is already rendered. */
  const focusNow = (id: string, at: "start" | "end") => {
    const el = root.current?.querySelector<HTMLTextAreaElement>(`textarea[data-id="${id}"]`);
    if (!el) return;
    el.focus();
    const pos = at === "end" ? el.value.length : 0;
    el.setSelectionRange(pos, pos);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>, el: ScriptElement) => {
    const ta = e.currentTarget;
    const i = ids.indexOf(el.id);
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Enter on an empty non-action line turns it into action instead of adding another.
      if (!el.text.trim() && el.type !== "action" && el.type !== "heading") {
        p.updateElement(el.id, { type: "action" });
        return;
      }
      pendingFocus.current = { id: p.insertElementAfter(el.id), at: "start" };
    } else if (e.key === "Tab") {
      e.preventDefault();
      const c = TAB_CYCLE.indexOf(el.type);
      const next = TAB_CYCLE[(c + (e.shiftKey ? TAB_CYCLE.length - 1 : 1)) % TAB_CYCLE.length];
      p.updateElement(el.id, { type: next });
      onFocusType(next);
    } else if (e.key === "Backspace" && !el.text && i > 0) {
      e.preventDefault();
      pendingFocus.current = { id: ids[i - 1], at: "end" };
      p.removeElement(el.id);
    } else if (e.key === "ArrowUp" && ta.selectionStart === 0 && ta.selectionEnd === 0 && i > 0) {
      e.preventDefault();
      focusNow(ids[i - 1], "end");
    } else if (e.key === "ArrowDown" && ta.selectionStart === ta.value.length && i < ids.length - 1) {
      e.preventDefault();
      focusNow(ids[i + 1], "start");
    }
  };

  const element = (el: ScriptElement) => (
    <textarea
      key={el.id}
      data-id={el.id}
      className={`sp-el sp-${el.type}`}
      rows={1}
      value={el.text}
      placeholder={PLACEHOLDER[el.type]}
      aria-label={TYPE_LABEL[el.type]}
      spellCheck
      ref={autosize}
      onChange={(e) => {
        p.updateElement(el.id, { text: e.target.value });
        autosize(e.target);
      }}
      onFocus={() => onFocusType(el.type)}
      onBlur={() => onFocusType(null)}
      onKeyDown={(e) => onKey(e, el)}
    />
  );

  const charName = (id: string) => characters.find((c) => c.id === id)?.name ?? "";
  const envName = (id?: string) => environments.find((x) => x.id === id)?.name;

  return (
    <div ref={root} className="screenplay">
      {splitScenes(script).map((scene) => {
        const meta = sceneMeta[scene.id] ?? { color: 1 };
        const cast = links.sceneCast[scene.id];
        return (
          <section
            key={scene.id}
            className="sp-scene"
            data-scene={scene.id}
            style={{ ["--beat" as string]: `var(--beat-${meta.color})` }}
          >
            <div className="sp-scene-bar">
              <span className="sp-num">{scene.index + 1}</span>
              <select
                className="sp-beat"
                value={meta.beatId ?? ""}
                aria-label={`Beat for scene ${scene.index + 1}`}
                onChange={(e) => {
                  const b = beats.find((x) => x.id === e.target.value);
                  p.setSceneMeta(scene.id, { beatId: b?.id, color: b?.color ?? meta.color });
                }}
              >
                <option value="">No beat</option>
                {beats.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <div className="sp-chips">
                {cast?.environmentId && (
                  <span className="chip chip--location" title="Location in Casting">
                    <MapPin size={11} aria-hidden /> {envName(cast.environmentId)}
                  </span>
                )}
                {cast?.characterIds.map((cid) => (
                  <span key={cid} className="chip chip--cast" title="Character in Casting">
                    <User size={11} aria-hidden /> {charName(cid)}
                  </span>
                ))}
              </div>
              <button
                className="sp-del"
                title="Delete scene"
                aria-label={`Delete scene ${scene.index + 1}`}
                onClick={() => {
                  if (!window.confirm(`Delete scene ${scene.index + 1} and its ${scene.elements.length} lines?`)) return;
                  for (const x of [scene.heading, ...scene.elements]) p.removeElement(x.id);
                }}
              >
                <Trash size={13} />
              </button>
            </div>
            {element(scene.heading)}
            {scene.elements.map(element)}
          </section>
        );
      })}
    </div>
  );
}

export { TYPE_LABEL };
