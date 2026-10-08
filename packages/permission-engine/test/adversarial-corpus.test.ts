import { describe, expect, it } from "vitest";
import { GuardedPermissionEngine, type Action } from "../src/index.js";

type CorpusCase = {
  readonly name: string;
  readonly rationale: string;
  readonly action: Action;
  readonly outcome: "allow" | "ask" | "deny";
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
  },
  {
    name: "a skill action that declares nothing remains approval-required",
    rationale:
      "Silence is not a claim, for skills as for built-ins: an undeclared access is read as a change.",
    action: action("skill", "load_skill", { id: "publishing/typst" }),
    outcome: "ask",
  },
  {
    name: "a connected tool cannot borrow a skill's read declaration",
    rationale:
      "Only the owner the app assigned carries the rule; an MCP server naming its tool load_skill and declaring a read gains nothing.",
    action: action("mcp", "load_skill", { id: "publishing/typst" }, undefined, {
      access: "read",
    }),
    outcome: "ask",
  },
  {
    name: "an unknown built-in remains approval-required",
    rationale:
      "Adding a new tool must not silently inherit the authority of an existing read-only tool.",
    action: action("built-in", "read_everything", {}),
    outcome: "ask",
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
  },
  {
    name: "multi-file edits remain possible after approval",
    rationale:
      "Atomic inspection reduces accidental partial edits but does not remove the need to approve durable changes.",
    action: action("built-in", "multi_edit", {
      edits: [{ path: "a.md", find: "old", replace: "new" }],
    }),
    outcome: "ask",
  },
  {
    name: "a narrow deletion remains possible after approval",
    rationale:
      "Deletion is not categorically forbidden, but arbitrary shell execution can destroy data and therefore never auto-runs.",
    action: action(
      "built-in",
      "bash",
      { command: "rm -- notes.tmp", explanation: "Delete one temporary file." },
      "rm -- notes.tmp",
    ),
    outcome: "ask",
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
        explanation: "List the current folder.",
      },
      "rm -rf -- /",
    ),
    outcome: "ask",
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
        explanation: "Show repository status.",
      },
      "git status && rm -rf -- .git",
    ),
    outcome: "ask",
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
        explanation: "Run a Node helper.",
      },
      "node -e \"require('fs').rmSync('data',{recursive:true})\"",
    ),
    outcome: "ask",
  },
  {
    name: "network calls remain possible after approval",
    rationale:
      "Remote tools can disclose workspace or conversation data and can cause remote effects.",
    action: action("mcp", "tavily_search", { query: "current news" }),
    outcome: "ask",
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
  },
  {
    name: "a read that does not say where it reaches remains approval-required",
    rationale:
      "Silence about containment is not a claim of containment. An undeclared scope resolves toward asking.",
    action: action("built-in", "read_file", { path: "notes.md" }, undefined, {
      access: "read",
    }),
    outcome: "ask",
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
  },
  {
    name: "loading instructions remains approval-required",
    rationale:
      "Instructions can influence later tool selection but never grant themselves tool authority.",
    action: action("skill", "load_skill", { id: "research" }),
    outcome: "ask",
  },
];

describe("adversarial permission corpus", () => {
  const engine = new GuardedPermissionEngine();

  for (const fixture of corpus) {
    it(`${fixture.name} — ${fixture.rationale}`, async () => {
      await expect(engine.decide(fixture.action)).resolves.toMatchObject({
        outcome: fixture.outcome,
      });
    });
  }
});
