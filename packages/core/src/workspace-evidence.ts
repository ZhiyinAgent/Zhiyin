import type { AuditLog } from "@zhiyin/audit";
import type { ConversationSummary, EvidenceState } from "@zhiyin/contract";
import type { Rewind } from "@zhiyin/rewind";

export async function readEvidence(
  audit: AuditLog,
  rewind: Rewind,
  tasks: readonly Pick<ConversationSummary, "id" | "title">[],
): Promise<EvidenceState> {
  const [allCorrections, recovery] = await Promise.all([
    audit.read(),
    rewind.recoveryStorage(),
  ]);
  const entries = allCorrections.slice(-200).map((entry) => {
    const title = tasks.find((task) => task.id === entry.taskId)?.title;
    return { ...entry, ...(title ? { taskTitle: title } : {}) };
  });
  return {
    corrections: {
      retainedEntries: allCorrections.length,
      shownEntries: entries.length,
      maximumEntries: audit.retentionLimit(),
      entries,
    },
    recovery,
    policy: {
      correctionRedaction:
        "Correction details are bounded and common credential fields are removed. Arbitrary sensitive document text cannot be detected reliably.",
      taskDeletion:
        "Deleting a conversation deletes its transcript, action evidence, and derived compacted context from saved history.",
      privateStorage:
        "Correction and recovery evidence stays on this computer and is not added to provider usage telemetry or shared evaluations.",
    },
  };
}

export async function clearEvidence(
  audit: AuditLog,
  rewind: Rewind,
  tasks: readonly Pick<ConversationSummary, "id" | "title">[],
  kind: "corrections" | "recovery",
): Promise<EvidenceState> {
  if (kind === "corrections") await audit.clear();
  else await rewind.clearRecovery();
  return readEvidence(audit, rewind, tasks);
}
