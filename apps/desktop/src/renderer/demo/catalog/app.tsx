import {
  ConnectionRecovery,
  ExportConversationDialog,
  IssueNotices,
  RestartNotice,
  useToast,
} from "../../ui/app/index.js";
import { UserTurn } from "../../ui/conversation/index.js";
import { Onboarding } from "../../ui/onboarding/index.js";
import {
  HistoryRecoveryGate,
  NewerHistoryGate,
  SavedConversationsUpdate,
} from "../../ui/recovery/index.js";
import { RewindMessage, type GoingBackProps } from "../../ui/rewind/index.js";
import { AppSettings } from "../../ui/settings/index.js";
import { useState, type ReactNode } from "react";
import type { Appearance, SpellingState } from "@zhiyin/contract";
import { demoSpellingLanguages } from "../fixtures/spelling.js";
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
              "C:\\Users\\sam\\AppData\\Roaming\\Zhiyin\\damaged-history\\history-2026-09-30T14-45-09-023Z",
            conversationId: "catalog-task",
            canDelete: true,
          },
        ]}
        onDelete={() => undefined}
        onDismiss={() => undefined}
        onShowKept={() => undefined}
      />
    ),
  },
  {
    id: "restart-notice",
    title: "Window restarted",
    description:
      "Said once when the window came back after its page crashed: nothing was lost and there is nothing to do.",
    render: () => (
      <div className="lab-anchor">
        <RestartNotice onDismiss={() => undefined} />
      </div>
    ),
  },
  {
    id: "export-conversation",
    title: "Export a conversation",
    description:
      "One Export item in a conversation's menu opens this: a page to read or data to analyse, each with a miniature of the file, then where it was saved.",
    render: () => <ExportSample />,
  },
  {
    id: "toast",
    title: "Confirmation toast",
    description:
      "A short confirmation that something the person asked for is done, such as a deleted conversation. It leaves on its own after four seconds.",
    render: () => <ToastSample />,
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
        onShowKept={() => undefined}
      />
    ),
  },
  {
    id: "issue-conversation-needs-update",
    title: "Conversation waiting for an update",
    description:
      "Shown in place of a conversation an earlier version saved, with a way back to the question about it.",
    render: () => (
      <IssueNotices
        issues={[
          {
            message:
              "“Rapport enseignement en maternelle” was saved by Zhiyin 0.1.0-alpha.1 and needs an update before it opens.",
            conversationId: "catalog-task",
            canUpdate: true,
          },
        ]}
        openConversationId="catalog-task"
        onUpdate={() => undefined}
      />
    ),
  },
  {
    id: "saved-conversations-update",
    title: "Update saved conversations",
    description:
      "Asked at launch when an earlier version saved some conversations: update them, later, or delete them after a second answer. One that cannot be updated is left as it was, and the dialog says how many.",
    render: () => <UpdateSample />,
  },
  {
    id: "newer-history",
    title: "History from a newer version",
    description:
      "In place of the workspace when a newer Zhiyin saved the history: nothing is opened or offered for a fresh start.",
    render: () => (
      <NewerHistoryGate
        newer={{ writtenBy: "0.2.0" }}
        onGetLatest={() => undefined}
        onOpenDataFolder={() => undefined}
      />
    ),
  },
  {
    id: "connection-recovery",
    title: "Connection recovery",
    description:
      "What the window shows when it cannot reach the app behind it, first and once trying again has failed.",
    render: () => (
      <div className="lab-stack">
        <ConnectionRecovery onRetry={() => undefined} />
        <ConnectionRecovery triedAgain onRetry={() => undefined} />
      </div>
    ),
  },
  {
    id: "conversation-rewind",
    title: "Conversation rewind",
    description:
      "Edit opens the message where it is; Resend goes back at once. Either asks first here: a file can be put back, one was changed by hand since, two were changed by a command, and an edit cannot be undone.",
    render: () => (
      <LabRewindMessage
        taskId="catalog-task"
        messageId="catalog-message"
        text="Rewrite the release note and update the draft file."
        bubble={
          <UserTurn text="Rewrite the release note and update the draft file." />
        }
        onPreview={async () => ({
          id: "catalog-rewind",
          taskId: "catalog-task",
          messageId: "catalog-message",
          draft: "Rewrite the release note and update the draft file.",
          discardedMessages: 4,
          laterUserMessages: 1,
          discardedActions: [
            {
              id: "catalog-action",
              action: "Edit release note",
              target: "release-notes.md",
              status: "completed",
              sequence: 5,
            },
            {
              id: "catalog-command",
              action: "Run a command",
              target: "python export.py",
              status: "completed",
              sequence: 6,
              commandChanges: {
                status: "checked",
                files: [
                  { path: "exports/summary.csv", change: "created" },
                  { path: "exports/chart.png", change: "updated" },
                ],
              },
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
        onSend={async () => undefined}
      />
    ),
  },
  {
    id: "conversation-rewind-later-messages",
    title: "Going back over later messages",
    description:
      "Resending an earlier message that changed nothing, which removes two later messages the person wrote: it asks first.",
    render: () => (
      <LabRewindMessage
        taskId="catalog-task"
        messageId="catalog-message"
        text="Summarise the meeting notes."
        bubble={<UserTurn text="Summarise the meeting notes." />}
        onPreview={async () => ({
          id: "catalog-rewind",
          taskId: "catalog-task",
          messageId: "catalog-message",
          draft: "Summarise the meeting notes.",
          discardedMessages: 6,
          laterUserMessages: 2,
          discardedActions: [],
          files: [],
        })}
        onCommit={async () => ({ files: [] })}
        onSend={async () => undefined}
      />
    ),
  },
  {
    id: "app-settings",
    title: "App settings",
    description:
      "The app's own settings, apart from the model: plain rows, each saying what it changes, with its control on the right, or below when it needs the width. German shows a language that could not be loaded.",
    render: () => <AppSettingsExample />,
  },
  {
    id: "onboarding",
    title: "Onboarding",
    description: "Choose starting plugins without restricting future work.",
    render: () => <Onboarding onComplete={async () => {}} />,
  },
];

/** A person's message in the lab, holding its own editing state. */
function LabRewindMessage(props: GoingBackProps & { bubble: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return <RewindMessage {...props} editing={editing} onEditing={setEditing} />;
}

function AppSettingsExample() {
  const [notifications, setNotifications] = useState(true);
  const [appearance, setAppearance] = useState<Appearance>("system");
  // German shows how a language that could not be loaded reads.
  const [spelling, setSpelling] = useState<SpellingState>({
    enabled: true,
    languages: [
      { code: "en-GB", status: "ready" },
      { code: "fr", status: "ready" },
      { code: "de", status: "unavailable" },
    ],
    offered: demoSpellingLanguages,
  });
  return (
    <div>
      <AppSettings
        notifications={notifications}
        onNotifications={async (enabled) => setNotifications(enabled)}
        onOpenDataFolder={async () => undefined}
        waitingForUpdate={2}
        onUpdateConversations={() => undefined}
        appearance={appearance}
        onAppearance={async (choice) => setAppearance(choice)}
        spelling={spelling}
        onSpelling={async (choice) =>
          setSpelling((shown) => ({
            ...shown,
            enabled: choice.enabled,
            languages: choice.languages.map(
              (code) =>
                shown.languages.find((language) => language.code === code) ?? {
                  code,
                  status: "ready",
                },
            ),
          }))
        }
        onClose={() => undefined}
      />
    </div>
  );
}

function ExportSample() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="button" type="button" onClick={() => setOpen(true)}>
        Export a conversation
      </button>
      {open && (
        <ExportConversationDialog
          title="Rapport enseignement en maternelle"
          onExport={async (format) => {
            await new Promise((resolve) => setTimeout(resolve, 700));
            return {
              status: "saved",
              destination: `C:\\Users\\sam\\Documents\\Rapport enseignement en maternelle.${format}`,
            };
          }}
          onShowInFolder={() => undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function ToastSample() {
  const [region, show] = useToast();
  return (
    <div>
      <button
        className="button"
        type="button"
        onClick={() =>
          show("“Rapport enseignement en maternelle” was deleted.")
        }
      >
        Show a confirmation
      </button>
      {region}
    </div>
  );
}

const updateSample = [
  { title: "Trip to Shanghai", writtenBy: "0.1.0-alpha.1" },
  { title: "Bakery website", writtenBy: "0.1.0-alpha.1" },
  { title: "Rapport enseignement en maternelle", writtenBy: "0.1.0-alpha.2" },
];

/**
 * The dialog as it is asked, with an update that succeeds for every
 * conversation or leaves one as it was.
 */
function UpdateSample() {
  const [open, setOpen] = useState<"all" | "one fails">();
  return (
    <div className="lab-stack">
      <button className="button" type="button" onClick={() => setOpen("all")}>
        Ask about saved conversations
      </button>
      <button
        className="button"
        type="button"
        onClick={() => setOpen("one fails")}
      >
        Ask, where one cannot be updated
      </button>
      {open && (
        <SavedConversationsUpdate
          waiting={updateSample}
          onSettle={async () => {
            await new Promise((resolve) => setTimeout(resolve, 700));
            return open === "all"
              ? { done: 3, failed: 0 }
              : { done: 2, failed: 1 };
          }}
          onClose={() => setOpen(undefined)}
        />
      )}
    </div>
  );
}
