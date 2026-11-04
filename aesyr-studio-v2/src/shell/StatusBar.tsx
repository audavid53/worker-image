import { ArrowCounterClockwise, CheckCircle, CloudCheck, Coins, Lightning } from "@phosphor-icons/react";
import { STAGES, stageIndex, type StageDef } from "../stages";

interface Props {
  stage: StageDef;
  approved: boolean;
  /** False until there is something to approve (no project generated yet). */
  canApprove: boolean;
  onApprove: () => void;
  onReopen: () => void;
}

const SMALL = { size: 13, weight: "regular" } as const;

export function StatusBar({ stage, approved, canApprove, onApprove, onReopen }: Props) {
  const isLast = stageIndex(stage.id) === STAGES.length - 1;
  return (
    <footer className="statusbar">
      <span className="status-item">
        <span className="dot" data-state={approved ? "ok" : "draft"} />
        {stage.label} · {approved ? "Approved" : "Draft"}
      </span>
      <span className="status-item status-item--wide">
        <CloudCheck {...SMALL} aria-hidden /> Saved locally
      </span>

      <span className="status-spacer" />

      {/* Credits and jobs are wired to the backend in milestones 1 and 8. */}
      <span className="status-item" title="Credits belong to each user">
        <Coins {...SMALL} aria-hidden /> —
      </span>
      <span className="status-item status-item--wide">
        <Lightning {...SMALL} aria-hidden /> 0 jobs
      </span>

      {approved ? (
        <button className="status-btn" onClick={onReopen}>
          <ArrowCounterClockwise {...SMALL} aria-hidden /> Reopen stage
        </button>
      ) : (
        <button
          className="status-btn status-btn--primary"
          onClick={onApprove}
          disabled={!canApprove}
          title={canApprove ? undefined : "Generate a story first"}
        >
          <CheckCircle {...SMALL} weight="fill" aria-hidden /> {isLast ? "Approve" : "Approve & continue"}
        </button>
      )}
    </footer>
  );
}
