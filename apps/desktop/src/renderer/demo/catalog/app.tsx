import { ExportConversationDialog } from "../../ui/conversation-dialogs/index.js";
import {
  ConnectionRecovery,
  IssueNotices,
  RestartNotice,
  useToast,
} from "../../ui/notices/index.js";
import { RunningCommands } from "../../ui/commands/index.js";
import { UserTurn } from "../../ui/conversation/index.js";
import { LookStep, Onboarding } from "../../ui/onboarding/index.js";
import { ModelStep } from "../../ui/model/index.js";
import {
  demoCatalog,
  demoModelList,
  demoModelListDownloaded,
  demoModelListUnreached,
  demoOpenRouter,
  demoProviderSummaries,
} from "../fixtures/models.js";
import {
  HistoryRecoveryGate,
  NewerHistoryGate,
  SavedConversationsUpdate,
} from "../../ui/recovery/index.js";
import { RewindMessage, type GoingBackProps } from "../../ui/rewind/index.js";
import { SettingsWithModelList } from "../../ui/app/index.js";
import { AppSettings } from "../../ui/settings/index.js";
import { UpdateReady } from "../../ui/sidebar/index.js";
import { useState, type ReactNode } from "react";
import {
  defaultLook,
  defaultWorkPauses,
  type AppUpdateState,
  type Appearance,
  type LookChoice,
  type ModelListState,
  type ProviderSettings,
  type SpellingState,
} from "@zhiyin/contract";
import { demoSpellingLanguages } from "../fixtures/spelling.js";
import type { ComponentCatalogEntry } from "./entry.js";

const labBuild = {
  id: "J1",
  command: "npm run build",
  explanation: "Builds the release to check that it still compiles.",
  startedAt: Date.now() - 125_000,
};

const at = "2026-11-07T09:42:00.000Z";

/** Each state the Updates group can be in, as the catalogue shows it. */
const updateStates: readonly [string, string, AppUpdateState][] = [
  [
    "current",
    "up to date",
    {
      version: "0.1.0-alpha.1",
      checks: true,
      phase: { kind: "idle" },
      lastLook: { at, outcome: "current" },
    },
  ],
  [
    "looking",
    "looking",
    { version: "0.1.0-alpha.1", checks: true, phase: { kind: "looking" } },
  ],
  [
    "downloading",
    "downloading",
    {
      version: "0.1.0-alpha.1",
      checks: true,
      phase: { kind: "downloading", version: "0.1.0-alpha.2", fraction: 0.42 },
      lastLook: { at, outcome: "found", version: "0.1.0-alpha.2" },
    },
  ],
  [
    "ready",
    "ready to install",
    {
      version: "0.1.0-alpha.1",
      checks: true,
      phase: { kind: "ready", version: "0.1.0-alpha.2" },
      lastLook: { at, outcome: "found", version: "0.1.0-alpha.2" },
    },
  ],
  [
    "refused",
    "refused",
    {
      version: "0.1.0-alpha.1",
      checks: true,
      phase: { kind: "idle" },
      lastLook: {
        at,
        outcome: "failed",
        reason:
          "GitHub: The release's signature does not match it. media.zhiyinagent.app could not be reached.",
      },
    },
  ],
  [
    "off",
    "not looking",
    { version: "0.1.0-alpha.1", checks: false, phase: { kind: "idle" } },
  ],
];

/**
 * Zhiyin's list of models and prices in Settings (ADR 0027): `state` when the
 * page opens, then `looked` once a look for a newer one ends, or never for a
 * look still under way.
 */
const modelListStates: readonly (readonly [
  string,
  string,
  string,
  ModelListState,
  ModelListState | "under way",
])[] = [
  [
    "checking",
    "looking for a newer one",
    "Each time Settings opens, Zhiyin looks on GitHub, or on its own copy when GitHub cannot be reached, for a newer signed list of models and prices, and says so while it looks.",
    demoModelList,
    "under way",
  ],
  [
    "downloaded",
    "updated",
    "A newer list was taken: Settings names its day and where it came from.",
    demoModelListDownloaded,
    demoModelListDownloaded,
  ],
  [
    "unreached",
    "out of reach",
    "A look that failed leaves the list in force, and says why no newer one could be used.",
    demoModelListUnreached,
    demoModelListUnreached,
  ],
  [
    "off",
    "updates off",
    "With the switch off, Zhiyin keeps the list it has and asks for no newer one.",
    { ...demoModelListDownloaded, updates: false },
    { ...demoModelListDownloaded, updates: false },
  ],
];

export const appEntries: ComponentCatalogEntry[] = [
  {
    id: "issue-damaged-conversation",
    title: "Damaged conversation notice",
    description:
      "One report per damaged conversation, where its copy was kept on its own line, and a way to delete it that asks first.",
    render: () => (
      <IssueNotices
        openConversationId="catalog-task"
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
        onShowKept={async () => undefined}
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
          waiting: 0,
          damaged: 2,
          keptAt: "C:/Users/sam/AppData/Roaming/Zhiyin/history.damaged.json",
        }}
        onChoose={async () => undefined}
        onShowKept={async () => undefined}
      />
    ),
  },
  {
    id: "history-recovery-waiting",
    title: "History recovery with conversations waiting",
    description:
      "The same choice when some saved conversations were saved by another version of Zhiyin: they wait for an update and stay where they are whichever is chosen.",
    render: () => (
      <HistoryRecoveryGate
        recovery={{
          readable: 4,
          waiting: 3,
          damaged: 1,
          keptAt: "C:/Users/sam/AppData/Roaming/Zhiyin/history.damaged.json",
        }}
        onChoose={async () => undefined}
        onShowKept={async () => undefined}
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
        onGetLatest={async () => undefined}
        onOpenDataFolder={async () => undefined}
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
    id: "running-commands",
    title: "Running commands",
    description:
      "In the conversation's header while commands it started run on: how many, opening on each with what it printed last and a way to stop it. When the list cannot be had, it says so rather than showing none.",
    render: () => (
      // Each at its own width, as in the header.
      <div className="lab-stack" style={{ justifyItems: "start" }}>
        <RunningCommands
          taskId="lab-running"
          running={[labBuild]}
          commands={{
            runningCommands: async () => [labBuild],
            commandOutput: async () => ({
              stdout:
                "vite v7 building for production…\n✓ 412 modules transformed.\n",
              stderr: "",
            }),
            stopCommand: async () => undefined,
          }}
          onListed={() => undefined}
        />
        <RunningCommands
          taskId="lab-unchecked"
          running={[]}
          commands={{
            runningCommands: async () => {
              throw new Error("The core did not answer.");
            },
            commandOutput: async () => undefined,
            stopCommand: async () => undefined,
          }}
          onListed={() => undefined}
        />
      </div>
    ),
  },
  {
    id: "conversation-rewind",
    title: "Conversation rewind",
    description:
      "Edit opens the message where it is; Resend goes back at once. Either asks first here: a file can be put back, one was changed by hand since, two were changed by a command, and an edit cannot be undone. Memory kept after the message: one entry can be taken back, one was changed since, one the person already kept, so the boxes for file and memory changes sit under one for everything.",
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
          memory: [
            {
              writeId: "catalog-write-style",
              number: 3,
              title: "How to work",
              status: "decided",
            },
            {
              writeId: "catalog-write-dates",
              number: 9,
              title: "Release dates for the spring launch",
              status: "changed",
              reason:
                "#9 Release dates for the spring launch was changed since, so it was left as it is.",
            },
            {
              writeId: "catalog-write-tone",
              number: 8,
              title: "Release notes are written for customers, not engineers",
              status: "undoable",
            },
          ],
        })}
        onCommit={async () => ({ files: [] })}
        onSend={async () => undefined}
      />
    ),
  },
  {
    id: "conversation-rewind-memory",
    title: "Going back over what was kept in memory",
    description:
      "Going back over a turn that kept one Knowledge entry and changed no file: one box, for memory changes, and the entry with what becomes of it, which follows the box.",
    render: () => (
      <LabRewindMessage
        taskId="catalog-task"
        messageId="catalog-message"
        text="Plan a weekend in Bordeaux."
        bubble={<UserTurn text="Plan a weekend in Bordeaux." />}
        onPreview={async () => ({
          id: "catalog-rewind",
          taskId: "catalog-task",
          messageId: "catalog-message",
          draft: "Plan a weekend in Bordeaux.",
          discardedMessages: 2,
          laterUserMessages: 0,
          discardedActions: [
            {
              id: "catalog-keep",
              action: "Keep in memory",
              target: "Lodging apart from the group",
              status: "completed",
              sequence: 3,
              memory: {
                writeId: "catalog-write-lodging",
                number: 5,
                title: "Lodging apart from the group",
                change: "added",
                scope: "everything",
                scopeName: "Everything you do",
                section: "knowledge",
              },
            },
          ],
          files: [],
          memory: [
            {
              writeId: "catalog-write-lodging",
              number: 5,
              title: "Lodging apart from the group",
              status: "undoable",
            },
          ],
        })}
        onCommit={async () => ({
          files: [],
          memory: [
            {
              writeId: "catalog-write-lodging",
              number: 5,
              title: "Lodging apart from the group",
              status: "undone",
            },
          ],
        })}
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
          memory: [],
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
  ...updateStates.map(([id, title, update]): ComponentCatalogEntry => ({
    id: `app-update-${id}`,
    title: `Updates: ${title}`,
    description:
      "Where updating Zhiyin stands, in Settings, with the switch that stops it looking (ADR 0027).",
    render: () => <AppUpdateExample initial={update} />,
  })),
  ...modelListStates.map(
    ([id, title, description, state, looked]): ComponentCatalogEntry => ({
      id: `model-list-${id}`,
      title: `Model list: ${title}`,
      description,
      render: () => <ModelListExample state={state} looked={looked} />,
    }),
  ),
  {
    id: "app-update-ready-sidebar",
    title: "Update ready, in the sidebar",
    description:
      "Said at the foot of the sidebar once an update is downloaded and checked. Restarting is refused while a conversation is working, and the reason shows under the button.",
    render: () => (
      <div style={{ width: 206 }}>
        <UpdateReady
          update={{
            version: "0.1.0-alpha.1",
            checks: true,
            phase: { kind: "ready", version: "0.1.0-alpha.12" },
          }}
          onRestart={async () => {
            throw new Error(
              "A conversation is still working. Zhiyin can restart once it has finished or been stopped.",
            );
          }}
        />
      </div>
    ),
  },
  {
    id: "onboarding",
    title: "Onboarding",
    description:
      "Choose starting plugins without restricting future work, then connect a model, then a look.",
    render: () => <OnboardingExample />,
  },
  {
    id: "onboarding-model",
    title: "Onboarding: connect a model, before a key",
    description:
      "Provider, key and model on one page, in the order they are done, each explained by its info button and none recommended. Continue stays off until a model is chosen.",
    render: () => <ModelStepExample keySaved={false} />,
  },
  {
    id: "onboarding-model-ready",
    title: "Onboarding: connect a model, key saved",
    description:
      "The key is saved, so the provider's models are listed; choosing one uses it.",
    render: () => <ModelStepExample keySaved />,
  },
  {
    id: "onboarding-look",
    title: "Onboarding: the look",
    description:
      "One card per listed look, each a small window wearing it; choosing one dresses the window.",
    render: () => <LookStepExample />,
  },
];

/** The model commands as the demo answers them, on a key saved or not. */
function demoModelSetup(keySaved: boolean) {
  const credential = keySaved
    ? ({ status: "configured", source: "credentialStore" } as const)
    : ({ status: "missing", source: "none" } as const);
  return {
    settings: {
      provider: demoOpenRouter,
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      credential,
    } satisfies ProviderSettings,
    onListProviders: async () =>
      demoProviderSummaries.map((summary) =>
        summary.id === "openrouter"
          ? {
              ...summary,
              accounts: summary.accounts.map((account) => ({
                ...account,
                credential,
              })),
            }
          : summary,
      ),
    onListModels: async () => demoCatalog,
    onSaveApiKey: async () => ({ status: "accepted" as const }),
    onSelectModel: async () => {},
    onOpenExternalUrl: async () => {},
  };
}

/** Onboarding with its model and look steps, choosing on copies. */
function OnboardingExample() {
  const [look, setLook] = useState<LookChoice>(defaultLook);
  return (
    <Onboarding
      onComplete={async () => {}}
      look={look}
      onLook={async (choice) => setLook(choice)}
      modelStep={(place) => <ModelStep {...place} {...demoModelSetup(false)} />}
    />
  );
}

/** Onboarding's model step on its own. */
function ModelStepExample({ keySaved }: { keySaved: boolean }) {
  return (
    <ModelStep
      label="STEP 2 OF 3"
      onBack={() => undefined}
      onContinue={() => undefined}
      onLater={() => undefined}
      {...demoModelSetup(keySaved)}
    />
  );
}

/** The look step on its own, as the second step shows it. */
function LookStepExample() {
  const [look, setLook] = useState<LookChoice>(defaultLook);
  return (
    <LookStep
      look={look}
      onLook={async (choice) => setLook(choice)}
      onBack={() => undefined}
      onStart={() => undefined}
      starting={false}
      error=""
    />
  );
}

/** Settings with its model list row, working on a copy. */
function ModelListExample({
  state,
  looked,
}: {
  state: ModelListState;
  looked: ModelListState | "under way";
}) {
  return (
    <SettingsWithModelList
      notifications={false}
      list={{
        state: async () => state,
        check: () =>
          looked === "under way"
            ? new Promise<ModelListState>(() => {})
            : Promise.resolve(looked),
        setUpdates: async (updates) => ({ ...state, updates }),
      }}
      onClose={() => undefined}
    />
  );
}

/** The Updates group alone, its switch and buttons working on a copy. */
function AppUpdateExample({ initial }: { initial: AppUpdateState }) {
  const [update, setUpdate] = useState(initial);
  return (
    <AppSettings
      notifications={false}
      appUpdate={update}
      onAppUpdateChecks={async (checks) =>
        setUpdate((shown) => ({ ...shown, checks }))
      }
      onCheckForAppUpdate={async () =>
        setUpdate((shown) => ({ ...shown, phase: { kind: "looking" } }))
      }
      onRestartToUpdate={async () =>
        setUpdate((shown) =>
          shown.phase.kind === "ready"
            ? {
                ...shown,
                phase: { kind: "restarting", version: shown.phase.version },
              }
            : shown,
        )
      }
      onClose={() => undefined}
    />
  );
}

/** A person's message in the lab, holding its own editing state. */
function LabRewindMessage(props: GoingBackProps & { bubble: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return <RewindMessage {...props} editing={editing} onEditing={setEditing} />;
}

function AppSettingsExample() {
  const [notifications, setNotifications] = useState(true);
  const [workPauses, setWorkPauses] = useState(defaultWorkPauses);
  const [studioReviews, setStudioReviews] = useState(true);
  const [reviewerModel, setReviewerModel] = useState<string>();
  const [appearance, setAppearance] = useState<Appearance>("system");
  const [look, setLook] = useState<LookChoice>(defaultLook);
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
        workPauses={workPauses}
        onWorkPauses={async (pauses) => setWorkPauses(pauses)}
        studioReviews={studioReviews}
        onStudioReviews={async (enabled) => setStudioReviews(enabled)}
        reviewerModel={reviewerModel}
        onChooseReviewerModel={() =>
          setReviewerModel("DeepSeek V4 Pro on DeepSeek · Mainland China")
        }
        onUseConversationModel={async () => setReviewerModel(undefined)}
        onOpenDataFolder={async () => undefined}
        waitingForUpdate={2}
        onUpdateConversations={() => undefined}
        appUpdate={{
          version: "0.1.0-alpha.1",
          checks: true,
          phase: { kind: "ready", version: "0.1.0-alpha.2" },
        }}
        onAppUpdateChecks={async () => undefined}
        onRestartToUpdate={async () => undefined}
        appearance={appearance}
        onAppearance={async (choice) => setAppearance(choice)}
        look={look}
        onLook={async (choice) => setLook(choice)}
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
