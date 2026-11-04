import { CaretLeft, CaretRight, MapPin, User } from "@phosphor-icons/react";
import { splitScenes } from "../../../shared/screenplay";
import { narrativeById } from "../../../shared/narratives";
import { useProject } from "../../data/project";
import type { CastLinks } from "../../data/script-ops";

/** Seconds a scene probably runs: narration/dialogue at the template pace, action at ~2.5 words/s. */
const estimateSeconds = (words: number, wps: number) => Math.max(2, Math.round(words / wps));

interface Props {
  links: CastLinks;
  onOpenScene: (id: string) => void;
}

/** SimpleScript-style beat board: one card per scene, coloured by its beat. */
export function BeatBoard({ links, onOpenScene }: Props) {
  const p = useProject();
  const { script, sceneMeta, beats, characters, environments, meta } = p.state;
  const scenes = splitScenes(script);
  const wps = (meta && narrativeById(meta.narrativeId)?.pace?.words_per_s) ?? 2.5;

  const moveScene = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= scenes.length) return;
    const blocks = scenes.map((s) => [s.heading, ...s.elements]);
    [blocks[index], blocks[j]] = [blocks[j], blocks[index]];
    p.setScript(blocks.flat());
  };

  return (
    <div className="beat-board">
      {scenes.map((scene, i) => {
        const m = sceneMeta[scene.id] ?? { color: 1 };
        const beat = beats.find((b) => b.id === m.beatId);
        const cast = links.sceneCast[scene.id];
        const words = scene.elements.reduce((s, e) => s + (e.text.match(/\S+/g)?.length ?? 0), 0);
        const firstAction = scene.elements.find((e) => e.type === "action")?.text ?? "";
        return (
          <article key={scene.id} className="bb-card" style={{ ["--beat" as string]: `var(--beat-${m.color})` }}>
            <header className="bb-band">
              <span>{beat?.name ?? "No beat"}</span>
              <span>~{estimateSeconds(words, wps)}s</span>
            </header>
            <button className="bb-body" onClick={() => onOpenScene(scene.id)} title="Open in script">
              <strong>
                {i + 1}. {scene.heading.text || "Untitled scene"}
              </strong>
              <p>{firstAction}</p>
            </button>
            <footer className="bb-foot">
              <div className="sp-chips">
                {cast?.environmentId && (
                  <span className="chip chip--location">
                    <MapPin size={11} aria-hidden /> {environments.find((x) => x.id === cast.environmentId)?.name}
                  </span>
                )}
                {cast?.characterIds.map((cid) => (
                  <span key={cid} className="chip chip--cast">
                    <User size={11} aria-hidden /> {characters.find((c) => c.id === cid)?.name}
                  </span>
                ))}
              </div>
              <div className="bb-move">
                <button aria-label="Move scene earlier" title="Move earlier" disabled={i === 0} onClick={() => moveScene(i, -1)}>
                  <CaretLeft size={12} />
                </button>
                <button aria-label="Move scene later" title="Move later" disabled={i === scenes.length - 1} onClick={() => moveScene(i, 1)}>
                  <CaretRight size={12} />
                </button>
              </div>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
