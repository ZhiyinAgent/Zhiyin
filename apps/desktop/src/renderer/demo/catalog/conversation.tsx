import { WorkspacePicker } from "../../ui/app/index.js";
import {
  Composer,
  ContextShelf,
  ConversationSkeleton,
  ConversationTimeline,
  MarkdownMessage,
  NewConversation,
  PlanPill,
  WorkTrace,
} from "../../ui/conversation/index.js";
import { LoadingSkeleton, Logo } from "../../ui/shared/index.js";
import type { ComponentCatalogEntry } from "./entry.js";

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
    title: "Conversation timeline",
    description:
      "The main conversation surface, including message ordering, work, and the completed outcome.",
    render: () => (
      <ConversationTimeline
        task={{
          id: "catalog-conversation",
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
              file: "release-notes.md",
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
    title: "Provider retry",
    description:
      "A transient provider failure shows a live wait before reconnecting.",
    render: () => (
      <ConversationTimeline
        task={{
          id: "catalog-retry",
          messages: [
            { id: "retry-user", role: "user", text: "Check the sources." },
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
    id: "waiting-for-specialists",
    title: "Waiting for specialists",
    description:
      "The turn has finished and specialists are still running: the conversation says whom it is waiting on, how many calls they have made and for how long.",
    render: () => (
      <ConversationTimeline
        task={{
          id: "catalog-waiting",
          messages: [
            {
              id: "waiting-user",
              role: "user",
              text: "Check every figure in the quarterly reports.",
            },
            {
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
      <div className="lab-stack">
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
    id: "context",
    title: "Context shelf",
    description: "Only relevant files or browser context; never a second plan.",
    render: () => (
      <div className="lab-shelves">
        <ContextShelf
          context={{
            kind: "workspace",
            project: "Zhiyin Desktop",
            files: [
              { name: "release-notes.md", meta: "Edited · 2 min ago" },
              { name: "changelog.md", meta: "Read" },
            ],
            changes: "+42 −8",
          }}
        />
        <ContextShelf
          context={{
            kind: "browser",
            title: "Zhiyin documentation",
            url: "docs.zhiyin.app/releases/new",
          }}
        />
      </div>
    ),
  },
  {
    id: "composer",
    title: "Composer",
    description:
      "Normal, running, and decision-paused states, and the folder picker that scopes the next message. The picker opens upward, since the composer sits at the bottom of the window. Running dims the field alone and lights the edge; paused dims the whole bar and shows the reason.",
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
          disabledReason="Answer the permission request first"
          disabledPlaceholder="Waiting for your decision"
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
      "A new conversation reads 0%; a model with no listed window is said to be unknown without looking empty or busy; once measured it fills against the chosen budget, and past it turns to a warning. Its menu chooses the budget, shows what uses space and compacts on request.",
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
            context={{ ...context, usage: usage(99_500) }}
          />
          <Composer
            onAddContext={() => undefined}
            context={{ ...context, budget: "low", usage: usage(131_000) }}
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
