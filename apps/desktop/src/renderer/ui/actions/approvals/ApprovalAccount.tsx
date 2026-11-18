import { PointedTip, modelAttribution } from "../../shared/index.js";
import styles from "./approvals.module.css";

/**
 * What the AI says the action is for, attributed to it: its label, then what
 * it wrote, so the claim reads as the AI's and not Zhiyin's.
 */
export function ApprovalAccount({
  claim,
}: {
  /** Everything the AI wrote about the action, already made visible. */
  claim?: string | undefined;
}) {
  if (!claim) return null;
  return (
    <div className={styles.approval__account}>
      <ApprovalClaim claim={claim} />
    </div>
  );
}

/**
 * What the AI says this action is for, attributed to it. The note beside the
 * attribution says why that matters: the model wrote it, so it is a claim to
 * check and not evidence. The note opens over the page, where the prompt says.
 */
function ApprovalClaim({ claim }: { claim: string }) {
  return (
    <p className={styles["approval__account-row"]}>
      <span className={styles["approval__account-label"]}>
        {modelAttribution}
        <PointedTip
          label="About this AI explanation"
          className={styles["approval__claim-about"]}
        >
          This explanation was written by the AI. It can be wrong or
          deliberately misleading. Check what will run and what will change
          before you approve.
        </PointedTip>
      </span>
      {claim}
    </p>
  );
}
