import { describe, expect, it } from "vitest";
import { GuardedPermissionEngine, type Action } from "../src/index.js";

type CorpusCase = {
  readonly name: string;
  readonly rationale: string;
  readonly action: Action;
  readonly outcome: "allow" | "ask" | "deny";
  readonly reason: string;
};

/** The reasons a decision gives, one for each kind of decision. */
const reasons = {
  containedRead:
    "This is a read-only action contained by the selected workspace.",
  pluginRead: "This reads what an enabled plugin contains.",
  connected:
    "This action uses a connected tool and requires an explicit decision.",
  outsideRead:
    "This reads outside the selected folder and requires an explicit decision.",
  change:
    "This action can change state or influence later work and requires an explicit decision.",
};

/**
 * `declared` is what the implementation said about its own action. It is
 * deliberately separate from the tool's name: the whole point of the rule
 * under test is that authority follows a declaration from an implementation
 * the app owns, never a name anyone can choose.
 */
const action = (
  owner: Action["owner"],
  name: string,
  arguments_: unknown,
  command = `${name}(${JSON.stringify(arguments_)})`,
  declared: Pick<Partial<Action>, "access" | "scope"> = {},
): Action => ({
  kind: "tool",
  owner,
  name,
  arguments: arguments_,
  action: "Exercise the permission boundary",
  target: "adversarial fixture",
  command,
  ...declared,
});

const corpus: readonly CorpusCase[] = [
  {
    name: "known workspace file reads do not need repetitive approval",
    rationale:
      "The built-in implementation constrains the resolved path to the selected workspace and has no write effect.",
    action: action("built-in", "read_file", { path: "notes.md" }, undefined, {
      access: "read",
      scope: "workspace",
    }),
    outcome: "allow",
    reason: reasons.containedRead,
  },
  {
    name: "known bounded directory listings do not need repetitive approval",
    rationale:
      "The built-in implementation stays inside the selected workspace, does not follow links, and bounds its result.",
    action: action("built-in", "list_directory", { path: "." }, undefined, {
      access: "read",
      scope: "workspace",
    }),
    outcome: "allow",
    reason: reasons.containedRead,
  },
  {
    name: "a safe-looking external read remains approval-required",
    rationale:
      "An MCP server owns its behavior; its name and read-only annotations are untrusted descriptions, not authority.",
    action: action("mcp", "read_file", { path: "notes.md" }, undefined, {
      access: "read",
      scope: "workspace",
    }),
    outcome: "ask",
    reason: reasons.connected,
  },
  {
    name: "reading an offered skill's instructions does not need approval",
    rationale:
      "The app loads the instructions of a plugin the person enabled. Reading them changes nothing and grants nothing; skills never carry permission.",
    action: action(
      "skill",
      "load_skill",
      { id: "publishing/typst" },
      undefined,
      { access: "read" },
    ),
    outcome: "allow",
    reason: reasons.pluginRead,
  },
  {
    name: "listing an enabled plugin's contents does not need approval",
    rationale:
      "The app describes a plugin the person enabled, without activating anything.",
    action: action(
      "plugin",
      "inspect_plugin",
      { id: "publishing" },
      undefined,
      { access: "read" },
    ),
    outcome: "allow",
    reason: reasons.pluginRead,
  },
  {
    name: "a skill action that declares nothing remains approval-required",
    rationale:
      "Silence is not a claim, for skills as for built-ins: an undeclared access is read as a change.",
    action: action("skill", "load_skill", { id: "publishing/typst" }),
    outcome: "ask",
    reason: reasons.change,
  },
  {
    name: "a connected tool cannot borrow a skill's read declaration",
    rationale:
      "Only the owner the app assigned carries the rule; an MCP server naming its tool load_skill and declaring a read gains nothing.",
    action: action("mcp", "load_skill", { id: "publishing/typst" }, undefined, {
      access: "read",
    }),
    outcome: "ask",
    reason: reasons.connected,
  },
  {
    name: "a skill action that declares a change remains approval-required",
    rationale:
      "Only a skill's reads run on their own; anything it would change is decided by the person.",
    action: action(
      "skill",
      "load_skill",
      { id: "publishing/typst" },
      undefined,
      { access: "change", scope: "workspace" },
    ),
    outcome: "ask",
    reason: reasons.change,
  },
  {
    name: "a plugin action that declares a change remains approval-required",
    rationale:
      "Describing an enabled plugin is a read; a plugin action that would change something is decided by the person.",
    action: action(
      "plugin",
      "inspect_plugin",
      { id: "publishing" },
      undefined,
      { access: "change", scope: "workspace" },
    ),
    outcome: "ask",
    reason: reasons.change,
  },
  {
    name: "a plugin read does not need approval whatever scope it names",
    rationale:
      "Reading what an enabled plugin contains reaches no workspace and no service, so a scope it names grants and removes nothing.",
    action: action(
      "plugin",
      "inspect_plugin",
      { id: "publishing" },
      undefined,
      { access: "read", scope: "outside" },
    ),
    outcome: "allow",
    reason: reasons.pluginRead,
  },
  {
    name: "an unknown built-in remains approval-required",
    rationale:
      "Adding a new tool must not silently inherit the authority of an existing read-only tool.",
    action: action("built-in", "read_everything", {}),
    outcome: "ask",
    reason: reasons.change,
  },
  {
    name: "creating a file remains possible after approval",
    rationale:
      "A typed workspace write is useful and bounded, but it changes durable user data.",
    action: action("built-in", "write_file", {
      path: "report.md",
      content: "report",
    }),
    outcome: "ask",
    reason: reasons.change,
  },
  {
    name: "multi-file edits remain possible after approval",
    rationale:
      "Atomic inspection reduces accidental partial edits but does not remove the need to approve durable changes.",
    action: action("built-in", "multi_edit", {
      edits: [{ path: "a.md", find: "old", replace: "new" }],
    }),
    outcome: "ask",
    reason: reasons.change,
  },
  {
    name: "a shell deletion is never automatic",
    rationale:
      "The shell tool refuses the deletions it recognises before anyone is asked, and points to delete_file; any shell action that reaches the engine still asks, since it can destroy data.",
    action: action(
      "built-in",
      "bash",
      { command: "rm -- notes.tmp", description: "Delete one temporary file." },
      "rm -- notes.tmp",
    ),
    outcome: "ask",
    reason: reasons.change,
  },
  {
    name: "a broad deletion cannot hide behind a benign claim",
    rationale:
      "The model-written explanation is not an authority source and arbitrary shell execution always needs a person.",
    action: action(
      "built-in",
      "bash",
      {
        command: "rm -rf -- /",
        description: "List the current folder.",
      },
      "rm -rf -- /",
    ),
    outcome: "ask",
    reason: reasons.change,
  },
  {
    name: "a shell action with chained commands remains approval-required",
    rationale:
      "The engine does not infer safety from a command prefix; the whole shell action stays approval-required.",
    action: action(
      "built-in",
      "bash",
      {
        command: "git status && rm -rf -- .git",
        description: "Show repository status.",
      },
      "git status && rm -rf -- .git",
    ),
    outcome: "ask",
    reason: reasons.change,
  },
  {
    name: "an interpreter shell action remains approval-required",
    rationale:
      "Code passed through an interpreter can perform any effect available to the process.",
    action: action(
      "built-in",
      "bash",
      {
        command: "node -e \"require('fs').rmSync('data',{recursive:true})\"",
        description: "Run a Node helper.",
      },
      "node -e \"require('fs').rmSync('data',{recursive:true})\"",
    ),
    outcome: "ask",
    reason: reasons.change,
  },
  {
    name: "network calls remain possible after approval",
    rationale:
      "Remote tools can disclose workspace or conversation data and can cause remote effects.",
    action: action("mcp", "tavily_search", { query: "current news" }),
    outcome: "ask",
    reason: reasons.connected,
  },
  {
    name: "a workspace search does not need repetitive approval",
    rationale:
      "Searching is a read the built-in implementation confines to the selected workspace; it produces no durable effect.",
    action: action("built-in", "search_files", { query: "budget" }, undefined, {
      access: "read",
      scope: "workspace",
    }),
    outcome: "allow",
    reason: reasons.containedRead,
  },
  {
    name: "a read outside the selected workspace remains approval-required",
    rationale:
      "The chosen folder is the scope a person consented to. Reaching past it is a new decision, not a continuation of the old one.",
    action: action(
      "built-in",
      "read_file",
      { path: "C:/Users/someone/.ssh/id_rsa" },
      undefined,
      { access: "read", scope: "outside" },
    ),
    outcome: "ask",
    reason: reasons.outsideRead,
  },
  {
    name: "a read that does not say where it reaches remains approval-required",
    rationale:
      "Silence about containment is not a claim of containment. An undeclared scope resolves toward asking.",
    action: action("built-in", "read_file", { path: "notes.md" }, undefined, {
      access: "read",
    }),
    outcome: "ask",
    reason: reasons.change,
  },
  {
    name: "a contained action that does not say it only reads remains approval-required",
    rationale:
      "A tool that makes no claim about its effect is treated as changing state, so a new built-in cannot become automatic by omission.",
    action: action(
      "built-in",
      "write_file",
      { path: "report.md", content: "report" },
      undefined,
      { scope: "workspace" },
    ),
    outcome: "ask",
    reason: reasons.change,
  },
  // The declarations the built-in tools send, so a rule that allowed what
  // they declare would fail here.
  {
    name: "a shell command asks however much it reads like a look around",
    rationale:
      "The shell tool declares every command a change and names no scope: nothing in a command string bounds what it reaches (ADR 0011).",
    action: action(
      "built-in",
      "bash",
      { command: "git status", description: "Show what changed." },
      "git status",
      { access: "change" },
    ),
    outcome: "ask",
    reason: reasons.change,
  },
  ...(
    [
      ["write_file", { path: "report.md", content: "report" }],
      ["multi_edit", { edits: [{ path: "a.md", replacements: [] }] }],
      ["delete_file", { paths: ["notes.tmp"] }],
    ] as const
  ).map(([name, arguments_]): CorpusCase => ({
    name: `${name} asks, as it declares a change inside the workspace`,
    rationale:
      "A change contained by the selected workspace still changes the person's files, so containment alone earns no automatic approval.",
    action: action("built-in", name, arguments_, undefined, {
      access: "change",
      scope: "workspace",
    }),
    outcome: "ask",
    reason: reasons.change,
  })),
  // Each reason belongs to its kind of decision, whatever else is declared.
  ...(["skill", "plugin"] as const).map((owner): CorpusCase => ({
    name: `a ${owner} read naming the workspace is still a plugin read`,
    rationale:
      "Reading what an enabled plugin contains is allowed as such; naming the workspace does not make it a contained workspace read.",
    action: action(owner, "load_skill", { id: "research" }, undefined, {
      access: "read",
      scope: "workspace",
    }),
    outcome: "allow",
    reason: reasons.pluginRead,
  })),
  {
    name: "a connected tool's read outside the folder is asked about as a connected tool",
    rationale:
      "Whatever a connected tool says of itself, what decides is that the app does not own it.",
    action: action("mcp", "read_file", { path: "C:/elsewhere" }, undefined, {
      access: "read",
      scope: "outside",
    }),
    outcome: "ask",
    reason: reasons.connected,
  },
  {
    name: "a built-in change outside the folder is asked about as a change, not a read",
    rationale:
      "Only a read outside the folder is described as one; a change there is a change.",
    action: action(
      "built-in",
      "write_file",
      { path: "C:/elsewhere/a.md", content: "x" },
      undefined,
      { access: "change", scope: "outside" },
    ),
    outcome: "ask",
    reason: reasons.change,
  },
  {
    name: "loading instructions remains approval-required",
    rationale:
      "Instructions can influence later tool selection but never grant themselves tool authority.",
    action: action("skill", "load_skill", { id: "research" }),
    outcome: "ask",
    reason: reasons.change,
  },
];

describe("adversarial permission corpus", () => {
  const engine = new GuardedPermissionEngine();

  for (const fixture of corpus) {
    it(`${fixture.name} — ${fixture.rationale}`, async () => {
      await expect(engine.decide(fixture.action)).resolves.toEqual({
        outcome: fixture.outcome,
        reason: fixture.reason,
      });
    });
  }
});
