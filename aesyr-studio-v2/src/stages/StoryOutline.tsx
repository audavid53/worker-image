import { ArrowDown, ArrowUp, Plus, Trash, Info } from "@phosphor-icons/react";
import { narrativeName, useProject, type Beat } from "../data/project";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function BeatRow({ beat, index, total }: { beat: Beat; index: number; total: number }) {
  const p = useProject();
  return (
    <li className="beat-row" style={{ ["--beat" as string]: `var(--beat-${beat.color})` }}>
      <button
        className="beat-color"
        title="Change colour"
        aria-label={`Colour ${beat.color}, click to change`}
        onClick={() => p.updateBeat(beat.id, { color: (beat.color % 9) + 1 })}
      />
      <div className="beat-body">
        <div className="beat-head">
          <input
            className="beat-name"
            value={beat.name}
            aria-label="Beat name"
            onChange={(e) => p.updateBeat(beat.id, { name: e.target.value })}
          />
          <label className="beat-secs" title="Target length in seconds">
            <input
              type="number"
              min={0}
              step={0.5}
              value={beat.targetSeconds}
              aria-label="Target seconds"
              onChange={(e) => p.updateBeat(beat.id, { targetSeconds: Math.max(0, Number(e.target.value) || 0) })}
            />
            s
          </label>
          <div className="row-actions">
            <button title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => p.moveBeat(beat.id, -1)}>
              <ArrowUp size={13} />
            </button>
            <button title="Move down" aria-label="Move down" disabled={index === total - 1} onClick={() => p.moveBeat(beat.id, 1)}>
              <ArrowDown size={13} />
            </button>
            <button title="Add beat below" aria-label="Add beat below" onClick={() => p.addBeatAfter(beat.id)}>
              <Plus size={13} />
            </button>
            <button title="Delete beat" aria-label="Delete beat" onClick={() => p.removeBeat(beat.id)}>
              <Trash size={13} />
            </button>
          </div>
        </div>
        <textarea
          className="beat-summary"
          rows={2}
          value={beat.summary}
          placeholder="What happens in this beat?"
          aria-label={`${beat.name} summary`}
          onChange={(e) => p.updateBeat(beat.id, { summary: e.target.value })}
        />
      </div>
    </li>
  );
}

export function StoryOutline() {
  const p = useProject();
  const { meta, beats } = p.state;

  if (!meta) {
    return (
      <div className="page empty-state">
        <h2>No story yet</h2>
        <p>Generate a story from the Idea stage to fill the outline.</p>
      </div>
    );
  }

  const planned = beats.reduce((s, b) => s + b.targetSeconds, 0);
  const acts: { act: string; items: { beat: Beat; index: number }[] }[] = [];
  beats.forEach((beat, index) => {
    const last = acts[acts.length - 1];
    if (last && last.act === beat.act) last.items.push({ beat, index });
    else acts.push({ act: beat.act, items: [{ beat, index }] });
  });

  return (
    <div className="page outline">
      <header className="outline-head">
        <input
          className="outline-title"
          value={meta.name}
          aria-label="Project name"
          onChange={(e) => p.updateMeta({ name: e.target.value })}
        />
        <div className="outline-meta">
          <span>{narrativeName(meta.narrativeId)}</span>
          <span>{meta.aspectRatio}</span>
          <span data-warn={Math.abs(planned - meta.runtimeSeconds) > meta.runtimeSeconds * 0.1 || undefined}>
            {fmt(planned)} of {fmt(meta.runtimeSeconds)}
          </span>
        </div>
        <textarea
          className="logline"
          rows={2}
          value={meta.logline}
          placeholder="Logline: one sentence that sells the story"
          aria-label="Logline"
          onChange={(e) => p.updateMeta({ logline: e.target.value })}
        />
        {meta.generatedBy === "offline" && (
          <p className="notice">
            <Info size={14} aria-hidden />
            <span>
              Drafted without AI: no OpenAI key is set on the server, so the beats are empty for you to write. Add{" "}
              <code>OPENAI_API_KEY</code> to <code>.env.local</code> to generate summaries and bios.
            </span>
          </p>
        )}
      </header>

      {acts.map((a, i) => (
        <section key={`${a.act}-${i}`} className="act">
          <h3>{a.act}</h3>
          <ol className="beats">
            {a.items.map(({ beat, index }) => (
              <BeatRow key={beat.id} beat={beat} index={index} total={beats.length} />
            ))}
          </ol>
        </section>
      ))}

      <button className="btn add-beat" onClick={() => p.addBeatAfter(null)}>
        <Plus size={14} aria-hidden /> Add beat
      </button>
    </div>
  );
}
