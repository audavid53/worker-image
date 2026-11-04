import { useEffect, useRef, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import type { Character } from "../../data/project";

/** Casting cell: removable chips plus a checklist popover of the project's characters. */
export function CastPicker({
  characters,
  value,
  onChange,
}: {
  characters: Character[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const name = (id: string) => characters.find((c) => c.id === id)?.name ?? "?";
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="cast-picker" ref={root}>
      {value.map((id) => (
        <span key={id} className="pill pill--cast">
          {name(id)}
          <button aria-label={`Remove ${name(id)}`} onClick={() => toggle(id)}>
            <X size={9} />
          </button>
        </span>
      ))}
      <button className="pill-add" aria-label="Add cast" aria-expanded={open} title="Add cast" onClick={() => setOpen((o) => !o)}>
        <Plus size={11} />
      </button>
      {open && (
        <div className="popover" role="listbox" aria-label="Cast">
          {characters.length === 0 && <p className="muted">No characters yet</p>}
          {characters.map((c) => (
            <label key={c.id} className="popover-row">
              <input type="checkbox" checked={value.includes(c.id)} onChange={() => toggle(c.id)} />
              {c.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
