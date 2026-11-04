import {
  BookOpenText,
  FilmSlate,
  Lightbulb,
  PersonSimpleRun,
  Scroll,
  type Icon,
} from "@phosphor-icons/react";
import type { StageId } from "../stages";

/** Shared icon settings: outline glyphs at Storyboarder's density (small, single weight). */
export const ICON = { size: 16, weight: "regular" } as const;

export const STAGE_ICONS: Record<StageId, Icon> = {
  idea: Lightbulb,
  story: BookOpenText,
  script: Scroll,
  shots: FilmSlate,
  motion: PersonSimpleRun,
};
