// Library store: built-in entries plus the user's own (library_entries with scope 'user' in the
// database; localStorage until the Supabase repository lands). User entries are per user, not per project.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { NarrativeStructure, ScenePreset } from "../../shared/library";
import { NARRATIVES } from "../../shared/narratives";
import { SCENE_PRESETS } from "../../shared/scene-presets";
import { useStoredState } from "../useStoredState";

interface UserLibrary {
  narratives: NarrativeStructure[];
  presets: ScenePreset[];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "entry";

/** A fresh id for a user copy: my-<name>-<4 chars>, never clashing with built-ins. */
export const customId = (name: string) => `my-${slug(name)}-${Math.random().toString(36).slice(2, 6)}`;

export interface LibraryUi {
  open: boolean;
  kind: "narrative" | "scene_preset";
  selected?: string;
}

function useLibraryState() {
  const [stored, setStored] = useStoredState<UserLibrary>("library", { narratives: [], presets: [] });
  const [ui, setUi] = useStoredState<LibraryUi>("libraryUi", { open: false, kind: "narrative" });

  // Drop anything that no longer validates (e.g. saved by an older schema) instead of crashing.
  const user = useMemo<UserLibrary>(
    () => ({
      narratives: (stored.narratives ?? []).flatMap((n) => {
        const r = NarrativeStructure.safeParse(n);
        return r.success ? [r.data] : [];
      }),
      presets: (stored.presets ?? []).flatMap((p) => {
        const r = ScenePreset.safeParse(p);
        return r.success ? [r.data] : [];
      }),
    }),
    [stored],
  );

  return useMemo(() => {
    const narratives = [...NARRATIVES, ...user.narratives];
    const presets = [...SCENE_PRESETS, ...user.presets];
    return {
      ui,
      openLibrary: (kind: LibraryUi["kind"], selected?: string) => setUi({ open: true, kind, selected }),
      selectInLibrary: (kind: LibraryUi["kind"], selected?: string) => setUi((u) => ({ ...u, kind, selected })),
      closeLibrary: () => setUi((u) => ({ ...u, open: false })),
      narratives,
      presets,
      narrative: (id: string) => narratives.find((n) => n.id === id),
      preset: (id: string) => presets.find((p) => p.id === id),
      isBuiltin: (id: string) => NARRATIVES.some((n) => n.id === id) || SCENE_PRESETS.some((p) => p.id === id),

      /** Validates and saves a user entry (insert or replace). Returns an error message or null. */
      saveNarrative: (n: unknown): string | null => {
        const r = NarrativeStructure.safeParse({ ...(n as object), source: "custom" });
        if (!r.success) return `${r.error.issues[0].path.join(" › ") || "entry"}: ${r.error.issues[0].message}`;
        if (NARRATIVES.some((b) => b.id === r.data.id)) return "Built-in entries can't be changed; duplicate it first.";
        setStored((s) => ({ ...s, narratives: [...(s.narratives ?? []).filter((x) => x.id !== r.data.id), r.data] }));
        return null;
      },
      savePreset: (p: unknown): string | null => {
        const r = ScenePreset.safeParse({ ...(p as object), source: "custom" });
        if (!r.success) return `${r.error.issues[0].path.join(" › ") || "entry"}: ${r.error.issues[0].message}`;
        if (SCENE_PRESETS.some((b) => b.id === r.data.id)) return "Built-in entries can't be changed; duplicate it first.";
        setStored((s) => ({ ...s, presets: [...(s.presets ?? []).filter((x) => x.id !== r.data.id), r.data] }));
        return null;
      },
      remove: (kind: "narrative" | "scene_preset", id: string) =>
        setStored((s) =>
          kind === "narrative"
            ? { ...s, narratives: (s.narratives ?? []).filter((x) => x.id !== id) }
            : { ...s, presets: (s.presets ?? []).filter((x) => x.id !== id) },
        ),
    };
  }, [user, setStored, ui, setUi]);
}

type LibraryApi = ReturnType<typeof useLibraryState>;
const Ctx = createContext<LibraryApi | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={useLibraryState()}>{children}</Ctx.Provider>;
}

export function useLibrary() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLibrary outside LibraryProvider");
  return v;
}
