import { useMemo, useState } from "react";
import {
  ArrowsOutCardinal,
  CircleNotch,
  Cube,
  CubeFocus,
  Image as ImageIcon,
  MapPin,
  MapPinPlus,
  Minus,
  Plus,
  Trash,
  User,
  X,
} from "@phosphor-icons/react";
import { CREDIT_COST, type Code3DSpec } from "../../../shared/casting";
import { useBoard } from "../../canvas/useBoard";
import { useProject, type CastAsset } from "../../data/project";
import { castLinks } from "../../data/script-ops";
import { ModelViewer } from "../../three/ModelViewer";
import { snapshot } from "../../three/primitives";

const CARD_W = 270;

interface CastItem {
  id: string;
  kind: "character" | "environment";
  name: string;
  description: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

function AssetView({ asset, name, onOpen3D }: { asset?: CastAsset; name: string; onOpen3D: (spec: Code3DSpec) => void }) {
  if (!asset) return null;
  if (asset.kind === "image" && asset.url) return <img src={asset.url} alt={`${name} reference`} />;
  if (asset.kind === "code3d" && asset.spec) {
    const src = snapshot(asset.id, asset.spec);
    return (
      <button className="asset-3d" onClick={() => onOpen3D(asset.spec!)} title="Open 3D viewer">
        {src ? <img src={src} alt={`${name} 3D blockout`} /> : <Cube size={28} aria-hidden />}
        <span>
          <CubeFocus size={12} aria-hidden /> View 3D
        </span>
      </button>
    );
  }
  return null;
}

export function CastingCanvas() {
  const p = useProject();
  const { meta, characters, environments, script, castLayout, assets, activeAsset } = p.state;
  const [busy, setBusy] = useState<Record<string, "image" | "code3d" | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [viewer, setViewer] = useState<{ spec: Code3DSpec; title: string } | null>(null);

  const items: CastItem[] = useMemo(
    () => [
      ...characters.map((c) => ({ id: c.id, kind: "character" as const, name: c.name, description: [c.role, c.description].filter(Boolean).join(". ") })),
      ...environments.map((e) => ({ id: e.id, kind: "environment" as const, name: e.name, description: e.description })),
    ],
    [characters, environments],
  );

  // Default layout: characters on the first row(s), locations below.
  const layout = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    const charRows = Math.ceil(characters.length / 4) || 0;
    characters.forEach((c, i) => (out[c.id] = castLayout[c.id] ?? { x: 40 + (i % 4) * 300, y: 70 + Math.floor(i / 4) * 470 }));
    environments.forEach(
      (e, i) => (out[e.id] = castLayout[e.id] ?? { x: 40 + (i % 4) * 300, y: 70 + charRows * 470 + Math.floor(i / 4) * 430 }),
    );
    return out;
  }, [characters, environments, castLayout]);

  const links = useMemo(() => castLinks(script, characters, environments), [script, characters, environments]);

  const board = useBoard({ positionOf: (id) => layout[id], onMove: (id, x, y) => p.moveCast(id, x, y), deps: [!!meta] });

  if (!meta) {
    return (
      <div className="canvas">
        <div className="canvas-label">
          <h2>Casting</h2>
          <p>Start from the Idea stage.</p>
        </div>
      </div>
    );
  }

  const run = async (item: CastItem, kind: "image" | "code3d") => {
    setBusy((b) => ({ ...b, [item.id]: kind }));
    setErrors((e) => ({ ...e, [item.id]: undefined }));
    try {
      if (kind === "image") {
        const r = await postJson<{ url: string; model: string; prompt: string }>("/api/image", {
          kind: item.kind,
          name: item.name,
          description: item.description,
          aspectRatio: meta.aspectRatio,
        });
        p.addAsset({ ownerId: item.id, kind: "image", url: r.url, prompt: r.prompt, model: r.model });
      } else {
        const r = await postJson<{ spec: Code3DSpec; model: string }>("/api/code3d", {
          kind: item.kind,
          name: item.name,
          description: item.description,
        });
        p.addAsset({ ownerId: item.id, kind: "code3d", spec: r.spec, prompt: item.description, model: r.model });
      }
    } catch (e) {
      setErrors((x) => ({ ...x, [item.id]: e instanceof Error ? e.message : "Generation failed" }));
    } finally {
      setBusy((b) => ({ ...b, [item.id]: undefined }));
    }
  };

  const addLocation = () => {
    const id = p.addEnvironment();
    const at = board.worldAt(0.5, 0.3);
    p.moveCast(id, at.x - CARD_W / 2, at.y);
  };

  return (
    <div ref={board.viewport} className="canvas board-canvas" {...board.handlers} style={board.viewportStyle}>
      <div className="canvas-layer" style={board.layerStyle}>
        {items.map((item) => {
          const pos = layout[item.id];
          const mine = assets.filter((a) => a.ownerId === item.id);
          const active = mine.find((a) => a.id === activeAsset[item.id]) ?? mine.at(-1);
          const scenesIn = links.appearances[item.id] ?? [];
          const state = busy[item.id];
          const Icon = item.kind === "character" ? User : MapPin;
          return (
            <article key={item.id} className="cast-card" data-kind={item.kind} style={{ left: pos.x, top: pos.y, width: CARD_W }}>
              <header className="char-card-head" data-drag-card={item.id} title="Drag to move">
                <ArrowsOutCardinal size={13} aria-hidden className="grip" />
                <Icon size={14} aria-hidden className="cast-kind" />
                <input
                  className="char-name"
                  value={item.name}
                  aria-label={item.kind === "character" ? "Character name" : "Location name"}
                  onChange={(e) =>
                    item.kind === "character"
                      ? p.updateCharacter(item.id, { name: e.target.value })
                      : p.updateEnvironment(item.id, { name: e.target.value })
                  }
                />
                {item.kind === "environment" && (
                  <button
                    title="Delete location"
                    aria-label={`Delete ${item.name}`}
                    onClick={() => window.confirm(`Delete ${item.name} and its assets?`) && p.removeEnvironment(item.id)}
                  >
                    <Trash size={13} />
                  </button>
                )}
              </header>

              <div className="cast-media" data-empty={!active || undefined}>
                {state ? (
                  <span className="cast-busy">
                    <CircleNotch size={22} className="spin" aria-hidden />
                    {state === "image" ? "Painting…" : "Building…"}
                  </span>
                ) : active ? (
                  <AssetView asset={active} name={item.name} onOpen3D={(spec) => setViewer({ spec, title: item.name })} />
                ) : (
                  <Icon size={28} aria-hidden />
                )}
              </div>

              {mine.length > 1 && (
                <div className="asset-strip" aria-label="Versions">
                  {mine.map((a, i) => (
                    <span key={a.id} className="asset-chip" data-active={a.id === active?.id || undefined}>
                      <button onClick={() => p.setActiveAsset(item.id, a.id)} title={`Show version ${i + 1}`}>
                        {a.kind === "image" ? <ImageIcon size={11} aria-hidden /> : <Cube size={11} aria-hidden />} v{i + 1}
                      </button>
                      <button aria-label={`Delete version ${i + 1}`} title="Delete version" onClick={() => p.removeAsset(a.id)}>
                        <X size={9} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="cast-gen">
                <button disabled={!!state} onClick={() => run(item, "image")} title="Google image model">
                  <ImageIcon size={13} aria-hidden /> 2D <em>{CREDIT_COST.image_google} cr</em>
                </button>
                <button disabled={!!state} onClick={() => run(item, "code3d")} title="Primitive blockout built by OpenAI, rendered with three.js">
                  <Cube size={13} aria-hidden /> Code 3D <em>{CREDIT_COST.llm_code3d} cr</em>
                </button>
                <button disabled title="Tripo text/image → 3D arrives with the job runner (milestone 8)">
                  <CubeFocus size={13} aria-hidden /> Tripo <em>{CREDIT_COST.tripo_model} cr</em>
                </button>
              </div>
              {errors[item.id] && (
                <p className="cast-error" role="alert">
                  {errors[item.id]}
                </p>
              )}

              <label className="card-field">
                <span>{item.kind === "character" ? "Look" : "Description"}</span>
                <textarea
                  rows={3}
                  value={item.kind === "character" ? (characters.find((c) => c.id === item.id)?.description ?? "") : item.description}
                  placeholder={item.kind === "character" ? "What they look like" : "What this place looks like"}
                  onChange={(e) =>
                    item.kind === "character"
                      ? p.updateCharacter(item.id, { description: e.target.value })
                      : p.updateEnvironment(item.id, { description: e.target.value })
                  }
                />
              </label>

              <footer className="cast-scenes">
                {scenesIn.length ? (
                  <>
                    <span>In scene{scenesIn.length > 1 ? "s" : ""}</span>
                    {scenesIn.map((n) => (
                      <span key={n} className="scene-pill">
                        {n}
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="muted">Not in the script yet</span>
                )}
              </footer>
            </article>
          );
        })}
      </div>

      <div className="canvas-label">
        <h2>Casting</h2>
        <p>
          {characters.length} characters · {environments.length} locations · credits are estimates until billing lands
        </p>
      </div>

      <div className="canvas-tools">
        <button onClick={addLocation} title="Add location">
          <MapPinPlus size={15} aria-hidden /> <span>Add location</span>
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

      {viewer && <ModelViewer spec={viewer.spec} title={viewer.title} onClose={() => setViewer(null)} />}
    </div>
  );
}
