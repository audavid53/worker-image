import { useEffect } from "react";
import { STAGES, isUnlocked, stageIndex, type StageId, type ViewMode } from "./stages";
import { useStoredState } from "./useStoredState";
import { TopBar, type Theme } from "./shell/TopBar";
import { StatusBar } from "./shell/StatusBar";
import { Workspace } from "./shell/Workspace";
import { CanvasPanel, StructuredPanel } from "./shell/Panels";
import { useProject } from "./data/project";
import { IdeaStage } from "./stages/IdeaStage";
import { StoryOutline } from "./stages/StoryOutline";
import { CharacterCanvas } from "./stages/CharacterCanvas";
import { ScriptPanel } from "./stages/script/ScriptPanel";
import { CastingCanvas } from "./stages/script/CastingCanvas";
import { ShotList } from "./stages/shots/ShotList";
import { DirectorCanvas } from "./stages/shots/DirectorCanvas";
import type { ReactNode } from "react";
import { useLibrary } from "./data/library";
import { LibraryDialog } from "./library/LibraryDialog";

/** Built panels per stage; stages not built yet fall back to placeholders. */
const PANELS: Partial<Record<StageId, { a: () => ReactNode; b: () => ReactNode }>> = {
  story: { a: () => <StoryOutline />, b: () => <CharacterCanvas /> },
  script: { a: () => <ScriptPanel />, b: () => <CastingCanvas /> },
  shots: { a: () => <ShotList />, b: () => <DirectorCanvas /> },
};

const VIEW_CYCLE: ViewMode[] = ["a", "split", "b"];

export function App() {
  const [theme, setTheme] = useStoredState<Theme>("theme", "dark");
  const [stageId, setStageId] = useStoredState<StageId>("stage", "idea");
  const [approved, setApproved] = useStoredState<Partial<Record<StageId, boolean>>>("approved", {});
  const [views, setViews] = useStoredState<Partial<Record<StageId, ViewMode>>>("views", {});
  const [splits, setSplits] = useStoredState<Partial<Record<StageId, number>>>("splits", {});
  const [pinned, setPinned] = useStoredState("toolbarPinned", false);
  const [focus, setFocus] = useStoredState("focusMode", false);
  const { state: project } = useProject();
  const library = useLibrary();

  const stage = STAGES.find((s) => s.id === stageId && isUnlocked(s.id, approved)) ?? STAGES[0];
  const view = views[stage.id] ?? "split";
  const split = splits[stage.id] ?? 0.5;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setView = (v: ViewMode) => setViews((p) => ({ ...p, [stage.id]: v }));
  const setSplit = (f: number) => setSplits((p) => ({ ...p, [stage.id]: f }));

  // A new story replaces everything downstream: Idea is approved, later approvals reset.
  const onGenerated = () => {
    setApproved({ idea: true });
    setStageId("story");
  };

  const approve = () => {
    setApproved((p) => ({ ...p, [stage.id]: true }));
    const next = STAGES[stageIndex(stage.id) + 1];
    if (next) setStageId(next.id);
  };

  // Reopening a stage reopens every later stage too (later work depends on it).
  const reopen = () =>
    setApproved((p) => {
      const out = { ...p };
      for (const s of STAGES.slice(stageIndex(stage.id))) delete out[s.id];
      return out;
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focus) {
        setFocus(false);
      } else if (e.altKey && /^[1-5]$/.test(e.key)) {
        const s = STAGES[Number(e.key) - 1];
        if (s && isUnlocked(s.id, approved)) setStageId(s.id);
        e.preventDefault();
      } else if (e.ctrlKey && e.key === "\\" && !stage.single) {
        setView(VIEW_CYCLE[(VIEW_CYCLE.indexOf(view) + 1) % VIEW_CYCLE.length]);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="app" data-focus={focus || undefined}>
      {/* In focus mode the bars slide away; these edge strips bring them back on hover. */}
      {focus && <div className="hotzone hotzone--top" aria-hidden />}
      <TopBar
        stage={stage}
        approved={approved}
        onStage={setStageId}
        view={view}
        onView={setView}
        theme={theme}
        onTheme={setTheme}
        pinned={pinned}
        onPinned={setPinned}
        focus={focus}
        onFocus={setFocus}
        onLibrary={() => library.openLibrary(library.ui.kind)}
      />
      <main className="stage-body">
        {stage.single || !stage.b ? (
          <IdeaStage onGenerated={onGenerated} />
        ) : (
          <Workspace
            key={stage.id}
            view={view}
            split={split}
            onSplit={setSplit}
            aLabel={stage.a.title}
            a={PANELS[stage.id]?.a() ?? <StructuredPanel def={stage.a} />}
            b={PANELS[stage.id]?.b() ?? <CanvasPanel def={stage.b} />}
          />
        )}
      </main>
      {focus && <div className="hotzone hotzone--bottom" aria-hidden />}
      <StatusBar
        stage={stage}
        approved={!!approved[stage.id]}
        canApprove={
          !!project.meta &&
          (stage.id !== "script" || project.script.length > 0) &&
          (stage.id !== "shots" || project.shots.length > 0)
        }
        onApprove={approve}
        onReopen={reopen}
      />
      <LibraryDialog />
    </div>
  );
}
