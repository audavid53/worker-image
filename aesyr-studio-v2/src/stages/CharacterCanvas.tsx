import { useEffect, useState } from "react";
import { ArrowsOutCardinal, LinkSimple, Minus, Plus, Trash, User, UserPlus, X } from "@phosphor-icons/react";
import { useBoard } from "../canvas/useBoard";
import { useProject, type Character } from "../data/project";

const CARD_W = 260;
/** Relationship lines join the card headers. */
const ANCHOR_Y = 22;

function Field({
  label,
  value,
  onChange,
  rows = 2,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label className="card-field">
      <span>{label}</span>
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function CharacterCanvas() {
  const p = useProject();
  const { meta, characters, relationships } = p.state;
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const board = useBoard({
    positionOf: (id) => characters.find((c) => c.id === id),
    onMove: (id, x, y) => p.updateCharacter(id, { x, y }),
    deps: [!!meta],
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLinkFrom(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!meta) {
    return (
      <div className="canvas">
        <div className="canvas-label">
          <h2>Character bios</h2>
          <p>Generate a story from the Idea stage to cast characters here.</p>
        </div>
      </div>
    );
  }

  const addAtCentre = () => {
    const at = board.worldAt(0.5, 0.33);
    p.addCharacter(at.x - CARD_W / 2, at.y);
  };

  const clickCard = (c: Character) => {
    if (linkFrom && linkFrom !== c.id) {
      p.addRelationship(linkFrom, c.id);
      setLinkFrom(null);
    }
  };

  const byId = new Map(characters.map((c) => [c.id, c]));

  return (
    <div
      ref={board.viewport}
      className="canvas board-canvas"
      data-linking={linkFrom ? "" : undefined}
      {...board.handlers}
      style={board.viewportStyle}
    >
      <div className="canvas-layer" style={board.layerStyle}>
        <svg className="rel-lines" aria-hidden>
          {relationships.map((r) => {
            const a = byId.get(r.from);
            const b = byId.get(r.to);
            if (!a || !b) return null;
            return <line key={r.id} x1={a.x + CARD_W / 2} y1={a.y + ANCHOR_Y} x2={b.x + CARD_W / 2} y2={b.y + ANCHOR_Y} />;
          })}
        </svg>

        {relationships.map((r) => {
          const a = byId.get(r.from);
          const b = byId.get(r.to);
          if (!a || !b) return null;
          return (
            <div key={r.id} className="rel-label" style={{ left: (a.x + b.x) / 2 + CARD_W / 2, top: (a.y + b.y) / 2 + ANCHOR_Y }}>
              <input
                value={r.label}
                placeholder="relationship"
                aria-label={`Relationship between ${a.name} and ${b.name}`}
                onChange={(e) => p.updateRelationship(r.id, e.target.value)}
                size={Math.max(8, r.label.length)}
              />
              <button aria-label="Remove relationship" title="Remove relationship" onClick={() => p.removeRelationship(r.id)}>
                <X size={11} />
              </button>
            </div>
          );
        })}

        {characters.map((c) => (
          <article
            key={c.id}
            className="char-card"
            data-link-source={linkFrom === c.id || undefined}
            style={{ left: c.x, top: c.y, width: CARD_W }}
            onClick={() => clickCard(c)}
          >
            <header className="char-card-head" data-drag-card={c.id} title="Drag to move">
              <ArrowsOutCardinal size={13} aria-hidden className="grip" />
              <input className="char-name" value={c.name} aria-label="Character name" onChange={(e) => p.updateCharacter(c.id, { name: e.target.value })} />
              <button
                title="Link to another character"
                aria-label={`Link ${c.name} to another character`}
                data-active={linkFrom === c.id || undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  setLinkFrom(linkFrom === c.id ? null : c.id);
                }}
              >
                <LinkSimple size={13} />
              </button>
              <button
                title="Delete character"
                aria-label={`Delete ${c.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete ${c.name}?`)) p.removeCharacter(c.id);
                }}
              >
                <Trash size={13} />
              </button>
            </header>
            <div className="char-portrait" title="Portraits and 3D models are added in Casting">
              <User size={26} aria-hidden />
            </div>
            <input className="char-role" value={c.role} placeholder="Role" aria-label="Role" onChange={(e) => p.updateCharacter(c.id, { role: e.target.value })} />
            <Field label="Look & bio" rows={3} value={c.description} onChange={(v) => p.updateCharacter(c.id, { description: v })} />
            <Field label="Wants" value={c.want} onChange={(v) => p.updateCharacter(c.id, { want: v })} />
            <Field label="Needs" value={c.need} onChange={(v) => p.updateCharacter(c.id, { need: v })} />
            <Field label="Arc" value={c.arc} onChange={(v) => p.updateCharacter(c.id, { arc: v })} />
          </article>
        ))}
      </div>

      <div className="canvas-label">
        <h2>Character bios</h2>
        <p>{linkFrom ? "Click another card to link it · Esc to cancel" : "Drag cards · drag the background to pan · Ctrl+wheel to zoom"}</p>
      </div>

      <div className="canvas-tools">
        <button onClick={addAtCentre} title="Add character">
          <UserPlus size={15} aria-hidden /> <span>Add character</span>
        </button>
        <button onClick={() => board.zoomBy(1 / 1.2)} title="Zoom out" aria-label="Zoom out">
          <Minus size={14} />
        </button>
        <button onClick={board.reset} title="Reset view" aria-label="Reset view">
          {Math.round(board.zoom * 100)}%
        </button>
        <button onClick={() => board.zoomBy(1.2)} title="Zoom in" aria-label="Zoom in">
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
