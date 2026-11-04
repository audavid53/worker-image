import { ArrowDown, ArrowUp, Plus, Trash } from "@phosphor-icons/react";
import type { NarrativeBeat, NarrativeStructure } from "../../shared/library";

const keyFrom = (name: string, taken: string[]) => {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "beat";
  let k = base;
  for (let i = 2; taken.includes(k); i++) k = `${base}-${i}`;
  return k;
};

const pct = (n: number) => Math.round(n * 1000) / 10;

/** Read-only for built-ins; edits a draft copy for the user's own entries. */
export function NarrativeEditor({
  value,
  readOnly,
  onChange,
}: {
  value: NarrativeStructure;
  readOnly: boolean;
  onChange: (n: NarrativeStructure) => void;
}) {
  const set = (patch: Partial<NarrativeStructure>) => onChange({ ...value, ...patch });
  const setBeat = (i: number, patch: Partial<NarrativeBeat>) => set({ beats: value.beats.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const total = value.beats.reduce((s, b) => s + b.share, 0);
  const moveBeat = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.beats.length) return;
    const beats = [...value.beats];
    [beats[i], beats[j]] = [beats[j], beats[i]];
    set({ beats });
  };

  return (
    <fieldset className="lib-form" disabled={readOnly}>
      <div className="lib-grid">
        <label className="field">
          <span>Name</span>
          <input value={value.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field lib-span2">
          <span>Description</span>
          <input value={value.blurb} onChange={(e) => set({ blurb: e.target.value })} />
        </label>
        <label className="field">
          <span>Shortest (s)</span>
          <input type="number" min={5} value={value.runtime.min_s} onChange={(e) => set({ runtime: { ...value.runtime, min_s: Number(e.target.value) } })} />
        </label>
        <label className="field">
          <span>Default length (s)</span>
          <input type="number" min={5} value={value.runtime.default_s} onChange={(e) => set({ runtime: { ...value.runtime, default_s: Number(e.target.value) } })} />
        </label>
        <label className="field">
          <span>Longest (s)</span>
          <input type="number" min={5} value={value.runtime.max_s} onChange={(e) => set({ runtime: { ...value.runtime, max_s: Number(e.target.value) } })} />
        </label>
        <label className="field">
          <span>Narration pace (words/s)</span>
          <input
            type="number"
            min={0.5}
            max={6}
            step={0.1}
            placeholder="—"
            value={value.pace?.words_per_s ?? ""}
            onChange={(e) => set({ pace: e.target.value ? { words_per_s: Number(e.target.value) } : undefined })}
          />
        </label>
      </div>

      <div className="lib-beats-head">
        <h3>Beats</h3>
        <span data-bad={Math.abs(total - 1) > 0.011 || undefined}>Shares total {pct(total)}%</span>
        {!readOnly && (
          <button
            type="button"
            className="btn btn--sm"
            disabled={total <= 0}
            onClick={() => set({ beats: value.beats.map((b) => ({ ...b, share: Math.round((b.share / total) * 10000) / 10000 })) })}
          >
            Normalise to 100%
          </button>
        )}
      </div>
      <table className="lib-beats">
        <thead>
          <tr>
            <th>Act</th>
            <th>Beat</th>
            <th>Purpose</th>
            <th>Share</th>
            <th>Shot hints</th>
            {!readOnly && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {value.beats.map((b, i) => (
            <tr key={i}>
              <td>
                <input value={b.act} aria-label={`Beat ${i + 1} act`} onChange={(e) => setBeat(i, { act: e.target.value })} />
              </td>
              <td>
                <input value={b.name} aria-label={`Beat ${i + 1} name`} onChange={(e) => setBeat(i, { name: e.target.value })} />
              </td>
              <td>
                <input value={b.purpose} aria-label={`Beat ${i + 1} purpose`} onChange={(e) => setBeat(i, { purpose: e.target.value })} />
              </td>
              <td className="lib-share">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={pct(b.share)}
                  aria-label={`Beat ${i + 1} share percent`}
                  onChange={(e) => setBeat(i, { share: Math.max(0, Number(e.target.value) || 0) / 100 })}
                />
                %
              </td>
              <td className="lib-bias">{b.default_shot_bias ? `${b.default_shot_bias.sizes.join(" ")} · ${b.default_shot_bias.moves.join(", ")}` : "—"}</td>
              {!readOnly && (
                <td className="lib-row-actions">
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => moveBeat(i, -1)}>
                    <ArrowUp size={12} />
                  </button>
                  <button type="button" aria-label="Move down" disabled={i === value.beats.length - 1} onClick={() => moveBeat(i, 1)}>
                    <ArrowDown size={12} />
                  </button>
                  <button type="button" aria-label="Delete beat" disabled={value.beats.length === 1} onClick={() => set({ beats: value.beats.filter((_, j) => j !== i) })}>
                    <Trash size={12} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <button
          type="button"
          className="btn btn--sm"
          onClick={() =>
            set({
              beats: [...value.beats, { key: keyFrom("New beat", value.beats.map((b) => b.key)), act: value.beats.at(-1)?.act ?? "Act 1", name: "New beat", purpose: "", share: 0 }],
            })
          }
        >
          <Plus size={12} aria-hidden /> Add beat
        </button>
      )}

      <label className="field">
        <span>Rules the writer must follow (one per line)</span>
        <textarea
          rows={3}
          value={value.global_rules.join("\n")}
          onChange={(e) =>
            set({
              global_rules: e.target.value
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      {value.evidence?.report_md && <p className="lib-evidence">Source: {value.evidence.report_md}</p>}
    </fieldset>
  );
}

/** Keeps beat keys valid and unique after free-text edits (keys feed the AI and scene links). */
export function withKeys(n: NarrativeStructure): NarrativeStructure {
  const taken: string[] = [];
  return {
    ...n,
    beats: n.beats.map((b) => {
      const ok = /^[a-z0-9-]{1,40}$/.test(b.key) && !taken.includes(b.key);
      const key = ok ? b.key : keyFrom(b.name, taken);
      taken.push(key);
      return { ...b, key };
    }),
  };
}
