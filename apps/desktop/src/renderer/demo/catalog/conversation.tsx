import { WorkspacePicker } from "../../ui/app/index.js";
import {
  Composer,
  ConversationSkeleton,
  ConversationTimeline,
  MarkdownMessage,
  NewConversation,
  PlanPill,
  UserTurn,
  WorkTrace,
} from "../../ui/conversation/index.js";
import {
  emptyConversationLists,
  type MessageAttachment,
  type StandingInstruction,
  type StoredPicture,
} from "@zhiyin/contract";
import { FailedTurnActions } from "../../ui/rewind/index.js";
import { LoadingSkeleton, Logo } from "../../ui/shared/index.js";
import type { ComponentCatalogEntry } from "./entry.js";

/** A picture as the store would answer for it, drawn here so the lab needs no file. */
async function samplePicture(): Promise<StoredPicture> {
  const drawing =
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#2f6f9f"/><rect x="40" y="200" width="60" height="80" fill="#f2c14e"/><rect x="130" y="140" width="60" height="140" fill="#f2c14e"/><rect x="220" y="90" width="60" height="190" fill="#f2c14e"/></svg>';
  return { status: "ready", mediaType: "image/svg+xml", data: btoa(drawing) };
}

function pictureAttachment(name: string): MessageAttachment {
  return {
    kind: "picture",
    id: name,
    name,
    mediaType: "image/png",
    bytes: 48_000,
    source: `pasted-pictures/c-lab/${name}`,
  };
}

const steps = [
  {
    id: "decisions",
    label: "Read architecture decisions",
    detail: "docs/decisions",
    status: "complete" as const,
  },
  {
    id: "history",
    label: "Read recent commits",
    detail: "12 commits in the current branch",
    status: "active" as const,
  },
];

/** The person's own instructions, and a folder's long enough to be cut. */
const standingInstructions: StandingInstruction[] = [
  {
    source: "personal",
    text: "Answer in French. Keep reports short and say plainly when a figure is an estimate.",
    bytes: 86,
    truncated: false,
  },
  {
    source: "folder",
    path: "AGENTS.md",
    text: "# Rapports trimestriels\n\nLes chiffres viennent du tableur partagé. Ne jamais arrondir les pourcentages au-delà d'une décimale.",
    bytes: 21_400,
    truncated: true,
  },
];

const responseFixture = `## Project state

Zhiyin is a **local-first desktop agent** with typed boundaries between its renderer, agent loop, tools, and permission engine.

### What is working

- Conversation state survives a restart.
- File reads require an explicit permission decision.
- Provider usage is recorded from the response rather than reconstructed locally.

| Area | Current state | Next risk |
| --- | --- | --- |
| Desktop shell | Operational | Long-response layout |
| Permission flow | Connected | Broader tool coverage |
| Usage | Provider-reported | Empty-history guidance |

Technical identifiers such as \`read_file\` belong in audit detail, not in the ordinary progress view.`;

export const conversationEntries: ComponentCatalogEntry[] = [
  {
    id: "conversation-timeline",
    className: "lab-section--thread",
    title: "Conversation timeline",
    description:
      "The main conversation surface, including message ordering, work, and the completed outcome.",
    render: () => (
      <ConversationTimeline
        task={{
          id: "catalog-conversation",
          ...emptyConversationLists,
          messages: [
            {
              id: "catalog-user",
              role: "user",
              text: "Prepare the release note and verify the result.",
              sequence: 1,
            },
            {
              id: "catalog-assistant",
              role: "assistant",
              text: "The release note is ready and the checks pass.",
              sequence: 2,
            },
          ],
          phase: {
            kind: "completed",
            outcome: {
              title: "Release note prepared",
              summary: "The draft was written and checked.",
            },
          },
        }}
        pieces={{
          actions: () => null,
          view: () => null,
          interaction: () => null,
        }}
      />
    ),
  },
  {
    id: "provider-retry",
    className: "lab-section--thread",
    title: "Provider retry",
    description:
      "A transient provider failure shows a live wait before reconnecting.",
    render: () => (
      <ConversationTimeline
        task={{
          id: "catalog-retry",
          ...emptyConversationLists,
          messages: [
            {
              sequence: 0,
              id: "retry-user",
              role: "user",
              text: "Check the sources.",
            },
          ],
          phase: {
            kind: "working",
            steps: [],
            note: "The model could not be reached. Trying again",
            retry: {
              readyAt: new Date(Date.now() + 30_000).toISOString(),
              count: "2 of 5",
            },
          },
        }}
        pieces={{
          actions: () => null,
          view: () => null,
          interaction: () => null,
        }}
      />
    ),
  },
  {
    id: "failed-turn",
    className: "lab-section--thread",
    title: "Failed turn",
    description:
      "A turn the provider ended: the reason, and what the person can do about it, the first step leading.",
    render: () => (
      <div>
        <ConversationTimeline
          task={{
            id: "catalog-failed",
            ...emptyConversationLists,
            messages: [
              {
                id: "failed-user",
                role: "user",
                text: "Summarise the meeting notes.",
                sequence: 0,
              },
            ],
            phase: {
              kind: "failed",
              reason: "The selected model is not available right now.",
              remedies: ["chooseModel", "tryAgain"],
            },
          }}
          pieces={{
            actions: () => null,
            view: () => null,
            interaction: () => null,
            failure: (remedies) => (
              <FailedTurnActions
                remedies={remedies}
                goingBack={{
                  taskId: "catalog-failed",
                  messageId: "failed-user",
                  text: "Summarise the meeting notes.",
                  onPreview: async () => ({
                    id: "catalog-rewind",
                    taskId: "catalog-failed",
                    messageId: "failed-user",
                    draft: "Summarise the meeting notes.",
                    discardedMessages: 1,
                    laterUserMessages: 0,
                    discardedActions: [],
                    files: [],
                  }),
                  onCommit: async () => ({ files: [] }),
                  onSend: async () => undefined,
                }}
                onEdit={() => undefined}
                onStep={() => undefined}
              />
            ),
          }}
        />
      </div>
    ),
  },
  {
    id: "waiting-for-specialists",
    className: "lab-section--thread",
    title: "Waiting for specialists",
    description:
      "The turn has finished and specialists are still running: the conversation says whom it is waiting on, how many calls they have made and for how long.",
    render: () => (
      <ConversationTimeline
        task={{
          id: "catalog-waiting",
          ...emptyConversationLists,
          messages: [
            {
              sequence: 0,
              id: "waiting-user",
              role: "user",
              text: "Check every figure in the quarterly reports.",
            },
            {
              sequence: 1,
              id: "waiting-assistant",
              role: "assistant",
              text: "I asked the fact-checker and the researcher to go through the reports. I'll summarise once they report back.",
            },
          ],
          waitingOn: {
            names: ["Fact-checker", "Researcher"],
            calls: 7,
            since: new Date(Date.now() - 80_000).toISOString(),
          },
          phase: {
            kind: "completed",
            outcome: { title: "Waiting", summary: "Specialists are working." },
          },
        }}
        pieces={{
          actions: () => null,
          view: () => null,
          interaction: () => null,
        }}
      />
    ),
  },
  {
    id: "new-conversation",
    title: "New conversation",
    description:
      "The empty conversation invitation in its normal and unavailable states.",
    render: () => (
      <div className="lab-states">
        <NewConversation onSuggestion={() => undefined} />
        <NewConversation disabled onSuggestion={() => undefined} />
      </div>
    ),
  },
  {
    id: "identity",
    title: "Identity",
    description: "The supplied SVG at every product size.",
    className: "lab-section--brand",
    render: () => (
      <div className="lab-brand">
        <Logo size={72} />
        <div className="lab-brand__sizes">
          <span className="lab-mark lab-mark--large">
            <Logo compact size={48} />
          </span>
          <span className="lab-mark lab-mark--medium">
            <Logo compact size={30} />
          </span>
          <span className="lab-mark lab-mark--small">
            <Logo compact size={18} />
          </span>
        </div>
      </div>
    ),
  },
  {
    id: "model-response",
    title: "Model response",
    description:
      "Structured long-form output with headings, lists, code, and wide data.",
    render: () => (
      <div className="lab-response">
        <MarkdownMessage>{responseFixture}</MarkdownMessage>
      </div>
    ),
  },
  {
    id: "plan-pill",
    title: "Plan",
    description:
      "One pill with the current step and a count, opening into the ordered steps the assistant keeps.",
    render: () => (
      <div className="lab-narrow" style={{ minHeight: 300 }}>
        <PlanPill
          items={[
            { id: "plan-1", title: "Review project evidence", status: "done" },
            { id: "plan-2", title: "Check the commit count", status: "done" },
            {
              id: "plan-3",
              title: "Publish the reviewed draft",
              status: "in_progress",
            },
            { id: "plan-4", title: "Send the summary", status: "pending" },
          ]}
        />
      </div>
    ),
  },
  {
    id: "work-trace",
    title: "Work trace",
    description:
      "Concrete action progress used when task guidance is unavailable.",
    render: () => (
      <div className="lab-narrow">
        <WorkTrace steps={steps} />
      </div>
    ),
  },
  {
    id: "attached-pictures",
    title: "Attached pictures",
    description:
      "Pictures pasted, dropped or chosen, on the message being written and on one sent. The attach button is off, saying why, for a model that cannot see pictures. A picture no longer stored says why in its place.",
    render: () => (
      <div className="lab-stack">
        <Composer
          seesPictures
          keepPicture={async () => ({
            status: "refused",
            reason: "The lab keeps nothing.",
          })}
          readPicture={samplePicture}
          draft={{
            id: "pictures",
            text: "What is wrong with this chart?",
            attachments: [
              pictureAttachment("chart-before.png"),
              pictureAttachment("pasted-2026-10-02-140512.png"),
            ],
          }}
        />
        <Composer
          seesPictures={false}
          keepPicture={async () => ({
            status: "refused",
            reason: "The lab keeps nothing.",
          })}
        />
        <UserTurn
          text="Here is the error I get."
          attachments={[
            pictureAttachment("error-dialog.png"),
            pictureAttachment("older-screenshot.png"),
          ]}
          readPicture={async (source) =>
            source.endsWith("older-screenshot.png")
              ? {
                  status: "missing",
                  reason: "This picture was deleted to save disk space.",
                }
              : samplePicture()
          }
        />
      </div>
    ),
  },
  {
    id: "pasted-text",
    title: "Pasted text",
    description:
      "A long paste kept as a file rather than poured into the message: on the message being written, where it can be taken off, and on one sent, where it opens in the person's own editor.",
    render: () => (
      <div className="lab-stack">
        <Composer
          keepPaste={async () => ({
            status: "refused",
            reason: "The lab keeps nothing.",
          })}
          openAttachment={() => undefined}
          draft={{
            id: "pasted",
            text: "Why does this log stop halfway?",
            attachments: [
              {
                kind: "pastedText",
                id: "pasted-2026-10-02-141207.txt",
                bytes: 184_320,
                lines: 2_416,
              },
            ],
          }}
        />
        <UserTurn
          text="Here is the full log."
          attachments={[
            {
              kind: "pastedText",
              id: "pasted-2026-10-02-141207.txt",
              bytes: 184_320,
              lines: 2_416,
            },
          ]}
          onOpen={() => undefined}
        />
      </div>
    ),
  },
  {
    id: "composer",
    title: "Composer",
    description:
      "Normal, running, and unavailable states, and the folder picker that scopes the next message. The picker opens upward, since the composer sits at the bottom of the window. Running keeps the field open for adding to the work and lights the edge; unavailable dims the whole bar and shows the reason. A pending approval or question does not pause it.",
    render: () => (
      <div className="lab-stack">
        <Composer
          scope={
            <WorkspacePicker
              current={{ path: "C:/work/reports", name: "reports" }}
              recent={[
                { path: "C:/work/reports", name: "reports" },
                { path: "C:/work/notes", name: "notes" },
                { path: "C:/work/quarterly-site", name: "quarterly-site" },
              ]}
              onChoose={() => undefined}
              onUseRecent={() => undefined}
            />
          }
        />
        <Composer
          running
          onStop={() => undefined}
          onAddContext={() => undefined}
          reasoningCapabilities={{
            status: "available",
            required: false,
            defaultEnabled: true,
            defaultEffort: "medium",
            efforts: ["low", "medium", "high"],
          }}
          scope={
            <WorkspacePicker
              disabled
              current={{ path: "C:/work/reports", name: "reports" }}
              recent={[]}
            />
          }
        />
        <Composer
          scope={<WorkspacePicker onChoose={() => undefined} />}
          disabledReason="Task execution is not connected yet"
          disabledPlaceholder="Composer unavailable"
        />
      </div>
    ),
  },
  {
    id: "reasoning-controls",
    title: "Reasoning control, in the states a model can put it in",
    description:
      "Reasoning the model requires, so there is nothing to turn off; reasoning a model offers but nobody has turned on; and a model that cannot report its reasoning settings at all, where the control says so rather than offering a choice it cannot honour.",
    render: () => (
      <div className="lab-stack">
        <Composer
          onAddContext={() => undefined}
          reasoningCapabilities={{
            status: "available",
            required: true,
            defaultEnabled: true,
            defaultEffort: "max",
            efforts: ["low", "high", "max"],
          }}
        />
        <Composer
          onAddContext={() => undefined}
          reasoningCapabilities={{
            status: "available",
            required: false,
            defaultEnabled: false,
            defaultEffort: "low",
            efforts: ["low", "medium", "high"],
          }}
          initialReasoning={{ enabled: false }}
        />
        <Composer
          onAddContext={() => undefined}
          reasoningCapabilities={{
            status: "unavailable",
            reason: "Reasoning settings are unavailable for this model.",
          }}
        />
      </div>
    ),
  },
  {
    id: "context-ring",
    title: "Context ring, unmeasured, part full and past its budget",
    description:
      "A new conversation reads 0%; a model with no listed window is said to be unknown without looking empty or busy; once measured it fills against the chosen budget, and past it turns to a warning. Its menu chooses the budget, shows what uses space and compacts on request; the last ring is compacting, so it breathes and its Compact is disabled. Open the second ring's menu to see the standing instructions its last turn sent, one source cut at the limit.",
    render: () => {
      const usage = (totalTokens: number) => ({
        model: "wide",
        totalTokens,
        measured: true,
        parts: {
          instructions: 3_000,
          tools: 9_000,
          summary: 0,
          conversation: totalTokens - 42_000,
          toolResults: 30_000,
        },
      });
      const wide = {
        model: "wide",
        contextWindow: 1_000_000,
        maximumOutputTokens: 131_072,
      };
      const context = {
        model: wide,
        budget: "medium" as const,
        onChoose: () => undefined,
        onCondense: async () => undefined,
      };
      return (
        <div className="lab-stack">
          <Composer onAddContext={() => undefined} context={context} />
          <Composer
            onAddContext={() => undefined}
            context={{
              ...context,
              usage: usage(99_500),
              instructions: standingInstructions,
              onEditInstructions: () => undefined,
            }}
          />
          <Composer
            onAddContext={() => undefined}
            context={{ ...context, budget: "low", usage: usage(131_000) }}
          />
          <Composer
            onAddContext={() => undefined}
            context={{ ...context, usage: usage(99_500), compacting: true }}
          />
        </div>
      );
    },
  },
  {
    id: "loading",
    title: "Loading placeholders",
    description:
      "Content-shaped placeholders preserve layout without faking progress.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-loading-grid">
        <ConversationSkeleton label="Loading task preview" />
        <LoadingSkeleton label="Loading list preview" />
      </div>
    ),
  },
];
