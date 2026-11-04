import {
  ArrowsIn,
  ArrowsOut,
  Columns,
  Graph,
  Lock,
  Moon,
  PushPin,
  PushPinSlash,
  Rows,
  Sun,
  type Icon,
} from "@phosphor-icons/react";
import type { ButtonHTMLAttributes } from "react";
import { STAGES, isUnlocked, type StageDef, type StageId, type ViewMode } from "../stages";
import { ICON, STAGE_ICONS } from "./icons";

export type Theme = "dark" | "midnight" | "light";

const THEMES: Theme[] = ["dark", "midnight", "light"];
const THEME_LABEL: Record<Theme, string> = { dark: "Dark", midnight: "Midnight", light: "Light" };

interface Props {
  stage: StageDef;
  approved: Partial<Record<StageId, boolean>>;
  onStage: (id: StageId) => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  pinned: boolean;
  onPinned: (p: boolean) => void;
  focus: boolean;
  onFocus: (f: boolean) => void;
}

/** Toolbar button: icon always visible, label collapses until the bar is hovered, focused or pinned. */
function TbButton({
  icon: Glyph,
  label,
  active,
  ...rest
}: { icon: Icon; label: string; active?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="tb-btn" data-active={active || undefined} aria-label={label} {...rest}>
      <Glyph {...ICON} weight={active ? "fill" : ICON.weight} aria-hidden />
      <span className="tb-label">{label}</span>
    </button>
  );
}

export function TopBar(p: Props) {
  const { stage, approved, view } = p;
  return (
    <header className="topbar" data-pinned={p.pinned || undefined}>
      <div className="brand" aria-label="Aesyr Studio">
        <span className="brand-mark" aria-hidden />
        <span className="brand-name">Aesyr</span>
      </div>

      <nav className="tb-group stage-tabs" aria-label="Pipeline stages">
        {STAGES.map((s, i) => {
          const open = isUnlocked(s.id, approved);
          const active = s.id === stage.id;
          return (
            <TbButton
              key={s.id}
              icon={open ? STAGE_ICONS[s.id] : Lock}
              label={s.label}
              active={active}
              data-done={approved[s.id] || undefined}
              disabled={!open}
              aria-current={active ? "step" : undefined}
              title={open ? `${s.label} (Alt+${i + 1})` : `${s.label}: approve the previous stage to unlock`}
              onClick={() => p.onStage(s.id)}
            />
          );
        })}
      </nav>

      <div className="tb-group tb-right">
        {!stage.single && stage.b && (
          <div className="tb-segment" role="radiogroup" aria-label="Panel view">
            {(
              [
                ["a", stage.a.title, Rows],
                ["split", "Split", Columns],
                ["b", stage.b.title, Graph],
              ] as const
            ).map(([v, label, glyph]) => (
              <TbButton
                key={v}
                icon={glyph}
                label={label}
                active={view === v}
                role="radio"
                aria-checked={view === v}
                title={`${label} (Ctrl+\\ cycles)`}
                onClick={() => p.onView(v)}
              />
            ))}
          </div>
        )}

        <TbButton
          icon={p.theme === "light" ? Sun : Moon}
          label={THEME_LABEL[p.theme]}
          title="Switch theme"
          onClick={() => p.onTheme(THEMES[(THEMES.indexOf(p.theme) + 1) % THEMES.length])}
        />
        <TbButton
          icon={p.focus ? ArrowsIn : ArrowsOut}
          label={p.focus ? "Exit focus" : "Focus"}
          title={p.focus ? "Show the bars again (Esc)" : "Hide the bars; they peek out at the screen edges"}
          onClick={() => p.onFocus(!p.focus)}
        />
        <TbButton
          icon={p.pinned ? PushPinSlash : PushPin}
          label={p.pinned ? "Unpin" : "Pin open"}
          title={p.pinned ? "Collapse labels to icons" : "Keep button labels open"}
          onClick={() => p.onPinned(!p.pinned)}
        />

        <span className="avatar" title="You">
          You
        </span>
      </div>
    </header>
  );
}
