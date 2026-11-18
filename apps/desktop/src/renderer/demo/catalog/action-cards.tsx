import { ActionHistory, ApprovalPrompt } from "../../ui/actions/index.js";
import type {
  ActionEffects,
  ApprovalRequest,
  TaskAction,
} from "@zhiyin/contract";
import type { ComponentCatalogEntry } from "./entry.js";

const nothing: ActionEffects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};
const does = (more: Partial<ActionEffects>): ActionEffects => ({
  ...nothing,
  ...more,
});
const shell = does({
  reads: "elsewhere",
  changes: "elsewhere",
  sends: "chosen",
  runs: "full-access",
  brings: "outside",
});

/** What a GitHub tool is sent, laid out from its schema. */
const githubCall = (name: string, more: { name: string; value: string }[]) => ({
  name,
  via: "https://api.githubcopilot.com/mcp/",
  arguments: [
    { name: "owner", value: '"lea-martin"' },
    { name: "repo", value: '"field-notes"' },
    ...more,
  ],
});

/** A repository with a 39-character owner and a 76-character name. */
const longPlace =
  "an-organisation-with-a-very-long-name-3/a-repository-whose-name-runs-on-and-on-to-show-how-long-places-wrap-in-marks";

/** One asking card for each part of the policy that asks (ADR 0012). */
const asking: {
  readonly why: NonNullable<ApprovalRequest["why"]>;
  readonly title: string;
  readonly target: string;
  readonly effects?: ActionEffects;
  readonly detail?: string;
  readonly claim?: string;
  readonly destinations?: readonly string[];
  readonly invocation?: ApprovalRequest["invocation"];
}[] = [
  {
    why: { code: "full-access" },
    title: "Run a command",
    target: "npm run release",
    effects: shell,
    claim: "Build and publish the release from the main branch.",
    invocation: {
      name: "run_command",
      arguments: [
        { name: "command", value: "npm run release", runs: true },
        { name: "Stops after", value: "10 min", readable: true },
      ],
    },
  },
  {
    why: { code: "runs-later" },
    title: "Create a file outside the workspace",
    target:
      "C:\\Users\\Léa\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\sync.cmd",
    effects: does({ reads: "elsewhere", changes: "elsewhere", lasting: true }),
    detail:
      "This file is in your Startup folder, so Windows runs it each time you sign in.",
  },
  {
    why: { code: "cannot-undo" },
    title: "Delete exports/archive.zip permanently",
    target: "exports/archive.zip",
    effects: does({ reads: "workspace", changes: "workspace-for-good" }),
    detail:
      "Windows would not move exports/archive.zip to the Recycle Bin: it is too large for it.",
  },
  {
    why: { code: "acts-for-good" },
    title: "GitHub · Merge pull request",
    target: "GitHub",
    effects: does({
      sends: "service",
      actsAsPerson: "for-good",
      brings: "outside",
      destination: "lea-martin/field-notes",
    }),
    destinations: [
      "lea-martin/field-notes",
      "https://api.githubcopilot.com/mcp/",
    ],
    claim: "Merge the reviewed fix for the date parser.",
    invocation: githubCall("merge_pull_request", [
      { name: "pullNumber", value: "14" },
      { name: "merge_method", value: '"squash"' },
    ]),
  },
  {
    why: { code: "outside-and-private", outsideFrom: "forum.example" },
    title: "Type into a page",
    target: "https://paste.example/new",
    effects: does({
      sends: "chosen",
      brings: "outside",
      destination: "https://paste.example/new",
    }),
    claim:
      "Paste the configuration so the forum post's instructions can be checked against it.",
  },
  {
    why: { code: "acts-as-you" },
    title: "GitHub · Add issue comment",
    target: "GitHub",
    effects: does({
      sends: "service",
      actsAsPerson: "once",
      brings: "outside",
      destination: "lea-martin/field-notes",
    }),
    destinations: [
      "lea-martin/field-notes",
      "https://api.githubcopilot.com/mcp/",
    ],
    invocation: githubCall("add_issue_comment", [
      { name: "issue_number", value: "12" },
      { name: "body", value: '"Fixed in #14."' },
    ]),
  },
  {
    why: { code: "outside-folder" },
    title: "Read a file outside the workspace",
    target: "D:\\Photos\\2026\\index.csv",
    effects: does({ reads: "elsewhere" }),
  },
  {
    why: { code: "outside-folder" },
    title: "Run a Python script",
    target: "a script, in data",
    effects: does({ reads: "elsewhere", changes: "elsewhere", runs: "sealed" }),
    detail:
      "The script reads and changes the workspace, and reaches no network. It can also change files in D:\\Photos\\2026, outside the folder you selected.",
  },
  {
    why: { code: "several" },
    title: "Create a file outside the workspace",
    target: "D:\\Shared\\report.pdf",
    effects: does({
      reads: "elsewhere",
      changes: "elsewhere",
      sends: "service",
      actsAsPerson: "once",
      destination: "team drive",
    }),
  },
  {
    why: { code: "connected-tool" },
    title: "Team wiki · Update page",
    target: "Team wiki",
    destinations: ["https://wiki.example.com/mcp"],
    invocation: {
      name: "update_page",
      via: "https://wiki.example.com/mcp",
      arguments: [
        { name: "page_id", value: '"release-checklist"' },
        {
          name: "body",
          value: '"Check the changelog before tagging."',
          described: "The page's new text, in Markdown.",
        },
      ],
    },
  },
  {
    why: { code: "you-asked-each-time" },
    title: "Team wiki · Delete page",
    target: "Team wiki",
    destinations: ["https://wiki.example.com/mcp"],
    invocation: {
      name: "delete_page",
      via: "https://wiki.example.com/mcp",
      arguments: [{ name: "page_id", value: '"old-onboarding"' }],
    },
  },
  {
    why: { code: "plugin-beyond-read" },
    title: "Run a skill's script",
    target: "release-notes-writing",
    effects: does({ reads: "workspace", changes: "workspace" }),
  },
];

/** The records of one turn, in each state an action can be in. */
const records: TaskAction[] = [
  {
    sequence: 1,
    id: "read-page",
    action: "Read page",
    target: "https://forum.example/t/sync-setup",
    description: "Read the forum's setup steps for the sync tool.",
    descriptionBy: "model",
    status: "completed",
    effects: does({ brings: "outside" }),
    brings: "outside",
    command: "browser_snapshot({})",
  },
  {
    sequence: 2,
    id: "search-downloads",
    action: "Search workspace files",
    target: "“api_key”",
    description:
      "Find where the downloaded sample configuration keeps its key, to compare it with the forum's steps.",
    descriptionBy: "model",
    status: "completed",
    effects: does({ reads: "workspace" }),
    brings: "outside",
    command: 'search_files({"query":"api_key"})',
  },
  {
    sequence: 3,
    id: "comment",
    action: "GitHub · Add issue comment",
    target: "GitHub",
    description: "Tell the reporter the fix is merged.",
    descriptionBy: "model",
    status: "completed",
    toolName: "mcp__github__add_issue_comment",
    effects: does({
      sends: "service",
      actsAsPerson: "once",
      brings: "outside",
      destination: "lea-martin/field-notes",
    }),
    approval: {
      by: "conversation-permission",
      at: "2026-10-31T09:00:00.000Z",
      permissionId: "permission-place",
    },
    command:
      'mcp__github__add_issue_comment({"owner":"lea-martin","repo":"field-notes","issue_number":12,"body":"Fixed in #14."})',
  },
  {
    sequence: 4,
    id: "build",
    action: "Run a command",
    target:
      "npm run build -- --mode production --out-dir C:\\Users\\Léa\\Projects\\field-notes\\dist\\release-candidate",
    description:
      "Build the site for production so the release candidate can be checked before it is published, with every page in the output folder.",
    descriptionBy: "model",
    status: "running",
    effects: shell,
  },
  {
    sequence: 5,
    id: "push",
    action: "Run a command",
    target: "git push --force",
    claim: "Replace the remote branch with the rebased one.",
    status: "denied",
    reason: "You denied this action. No further work ran.",
    effects: shell,
  },
  {
    sequence: 6,
    id: "install",
    action: "Add packages to a Python environment",
    target: "pandas, into data",
    status: "failed",
    reason:
      "pypi.org could not be reached, and neither could the mirror. Check the connection and try again.",
    effects: does({ changes: "app", sends: "service", runs: "sealed" }),
    command: 'install_python_package({"packages":["pandas"]})',
  },
  {
    sequence: 7,
    id: "startup",
    action: "Create a file outside the workspace",
    target: "Startup\\sync.cmd",
    status: "blocked",
    reason: "Zhiyin does not write where Windows starts programs on its own.",
    effects: does({ reads: "elsewhere", changes: "elsewhere", lasting: true }),
  },
];

export const actionCardEntries: ComponentCatalogEntry[] = [
  {
    id: "action-card-long-place",
    title: "A long place, and none",
    description:
      "A mark naming a repository with a 39-character owner and a 76-character name wraps inside its card, in a narrow lane and in the record; an action as you that names no place says Zhiyin can't tell where, and is not marked as one that can't be undone.",
    render: () => (
      <div className="lab-stack">
        <div style={{ width: 420 }}>
          <ApprovalPrompt
            title="GitHub · Add issue comment"
            target="GitHub"
            effects={does({
              sends: "service",
              actsAsPerson: "once",
              brings: "outside",
              destination: longPlace,
            })}
            why={{ code: "acts-as-you" }}
            destinations={[longPlace, "https://api.githubcopilot.com/mcp/"]}
            onDecision={() => undefined}
          />
        </div>
        <ApprovalPrompt
          title="Team drive · Share file"
          target="Team drive"
          effects={does({ sends: "service", actsAsPerson: "once" })}
          why={{ code: "acts-as-you" }}
          onDecision={() => undefined}
        />
        <div className="lab-narrow">
          <ActionHistory
            actions={[
              {
                sequence: 1,
                id: "long-place",
                action: "GitHub · Add issue comment",
                target: "GitHub",
                status: "completed",
                effects: does({
                  sends: "service",
                  actsAsPerson: "once",
                  destination: longPlace,
                }),
              },
            ]}
          />
        </div>
      </div>
    ),
  },
  {
    id: "action-card-why",
    title: "Why a card asks",
    description:
      "The asking state of the action card for each part of the policy that asks: its kind, the marks of what it does, why the person is asked and what saying no protects, then what the AI says, attributed. Outside content names where it came from.",
    render: () => (
      <div className="lab-stack">
        {asking.map((card) => (
          <ApprovalPrompt
            key={card.why.code}
            title={card.title}
            target={card.target}
            why={card.why}
            effects={card.effects}
            detail={card.detail}
            claim={card.claim}
            destinations={card.destinations}
            invocation={card.invocation}
            onDecision={() => undefined}
          />
        ))}
      </div>
    ),
  },
  {
    id: "action-card-grants",
    title: "Grants for the conversation",
    description:
      "Every grant a card offers is the same kind of button, beside Deny and Allow once, named by what it covers and taken in one press: a file outside the workspace and its folder, a file too large to copy, a place the action acts as you on, and a set of a connection's calls. Its tip says in full what it covers. Each is taken back under the conversation's Permissions.",
    render: () => (
      <div className="lab-stack">
        <ApprovalPrompt
          title="Edit a file outside the workspace"
          target="D:\Shared\notes\plan.md"
          effects={does({ reads: "elsewhere", changes: "elsewhere" })}
          why={{ code: "outside-folder" }}
          changes={[
            {
              path: "D:\\Shared\\notes\\plan.md",
              change: "updated",
              before: "# Plan\n\n- Draft\n",
              after: "# Plan\n\n- Draft\n- Review with Ana\n",
            },
          ]}
          fileRules={[
            { choice: "file", label: "plan.md" },
            { choice: "folder", label: "D:\\Shared\\notes\\" },
          ]}
          onDecision={() => undefined}
        />
        {/* A scene too large to copy, which every script saves: allowed
            for the conversation by that file, its changes not backed up. */}
        <ApprovalPrompt
          title="Run a Blender script"
          target="stand.blend"
          effects={does({
            reads: "workspace",
            changes: "workspace-for-good",
            runs: "sealed",
          })}
          why={{ code: "cannot-undo" }}
          fileRules={[
            { choice: "file", label: "stand.blend", withoutBackup: true },
          ]}
          onDecision={() => undefined}
        />
        <ApprovalPrompt
          title="GitHub · Add issue comment"
          target="GitHub"
          effects={does({
            sends: "service",
            actsAsPerson: "once",
            brings: "outside",
            destination: "lea-martin/field-notes",
          })}
          why={{ code: "acts-as-you" }}
          destinations={[
            "lea-martin/field-notes",
            "https://api.githubcopilot.com/mcp/",
          ]}
          invocation={githubCall("add_issue_comment", [
            { name: "issue_number", value: "12" },
            { name: "body", value: '"Fixed in #14."' },
          ])}
          conversationRule={{
            label: "GitHub · lea-martin/field-notes",
            scope: "destination",
          }}
          onDecision={() => undefined}
        />
        <div className="lab-dock">
          <ApprovalPrompt
            title="Team wiki · Update page"
            target="Team wiki"
            why={{ code: "connected-tool" }}
            destinations={["https://wiki.example.com/mcp"]}
            invocation={{
              name: "update_page",
              via: "https://wiki.example.com/mcp",
              arguments: [
                { name: "page_id", value: '"release-checklist"' },
                { name: "body", value: '"Check the changelog."' },
              ],
            }}
            conversationRule={{
              label: "Team wiki · Update page · only this exact call",
              scope: "tool",
            }}
            onDecision={() => undefined}
          />
        </div>
      </div>
    ),
  },
  {
    id: "action-card-states",
    title: "An action card in every state",
    description:
      "The record of a turn's actions: done, running, denied, failed and blocked, each with the same kind box, tinted by how it stands, and the marks of what it does. A row that brought outside content says so. What the AI wrote is attributed; a long target and a long account give way at their end, and Details opens them whole.",
    render: () => (
      <div className="lab-narrow">
        <ActionHistory actions={records} onOpenPermission={() => undefined} />
      </div>
    ),
  },
];
