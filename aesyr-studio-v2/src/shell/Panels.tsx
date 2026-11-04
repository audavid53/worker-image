import type { PanelDef } from "../stages";

/** Placeholder structured panel for stages not built yet: a "page" card over the darker background. */
export function StructuredPanel({ def }: { def: PanelDef }) {
  return (
    <div className="page">
      <header className="pane-head">
        <h2>{def.title}</h2>
        <p>{def.hint}</p>
      </header>
      <div className="placeholder-rows" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="placeholder-row">
            <span className="chip" style={{ background: `var(--beat-${(i % 9) + 1})` }} />
            <span className="bar" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Placeholder canvas panel: darkest background with a dot grid. */
export function CanvasPanel({ def }: { def: PanelDef }) {
  return (
    <div className="canvas">
      <div className="canvas-label">
        <h2>{def.title}</h2>
        <p>{def.hint}</p>
      </div>
    </div>
  );
}
