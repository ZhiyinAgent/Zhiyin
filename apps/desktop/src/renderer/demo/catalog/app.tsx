import { IssueNotices } from "../../ui/app/index.js";
import { UserTurn } from "../../ui/conversation/index.js";
import { Onboarding } from "../../ui/onboarding/index.js";
import { HistoryRecoveryGate } from "../../ui/recovery/index.js";
import { RewindMessage } from "../../ui/rewind/index.js";
import type { ComponentCatalogEntry } from "./entry.js";

export const appEntries: ComponentCatalogEntry[] = [
  {
    id: "issue-damaged-conversation",
    title: "Damaged conversation notice",
    description:
      "One report per damaged conversation, where its copy was kept on its own line, and a way to delete it.",
    render: () => (
      <IssueNotices
        issues={[
          {
            message:
              "“Rapport enseignement en maternelle” is damaged and can't be opened. Your other conversations are unaffected.",
            keptAt:
              "C:\\Users\\sam\\AppData\\Roaming\\desktop\\damaged-history\\history-2026-09-30T14-45-09-023Z",
            conversationId: "catalog-task",
          },
        ]}
        onDelete={() => undefined}
        onDismiss={() => undefined}
      />
    ),
  },
  {
    id: "history-recovery",
    title: "History recovery",
    description:
      "The startup choice shown when some saved conversations can be recovered and others are damaged.",
    render: () => (
      <HistoryRecoveryGate
        recovery={{
          readable: 4,
          damaged: 2,
          keptAt: "C:/Users/sam/AppData/Roaming/Zhiyin/history.damaged.json",
        }}
        onChoose={async () => undefined}
      />
    ),
  },
  {
    id: "conversation-rewind",
    title: "Conversation rewind",
    description:
      "An in-place rewind review with an explicit file choice, recoverable paths, conflicts, and effects that remain.",
    render: () => (
      <RewindMessage
        taskId="catalog-task"
        messageId="catalog-message"
        bubble={
          <UserTurn text="Rewrite the release note and update the draft file." />
        }
        onPreview={async () => ({
          id: "catalog-rewind",
          taskId: "catalog-task",
          messageId: "catalog-message",
          draft: "Rewrite the release note and update the draft file.",
          discardedMessages: 4,
          discardedActions: [
            {
              id: "catalog-action",
              action: "Edit release note",
              target: "release-notes.md",
              status: "completed",
            },
          ],
          files: [
            {
              path: "release-notes.md",
              action: "restore",
              status: "recoverable",
            },
            {
              path: "notes/manual-edits.md",
              action: "restore",
              status: "conflict",
            },
          ],
        })}
        onCommit={async () => ({ files: [] })}
        onCommitted={() => undefined}
      />
    ),
  },
  {
    id: "onboarding",
    title: "Onboarding",
    description: "Choose starting plugins without restricting future work.",
    render: () => <Onboarding onComplete={async () => {}} />,
  },
];
