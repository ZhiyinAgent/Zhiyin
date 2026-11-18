/**
 * A call the code that owns its tool marks to be asked about every time is
 * asked about, whatever it declares it does, and no grant for the
 * conversation covers it (ADR 0012).
 */

import { describe, expect, it } from "vitest";
import type { ActionEffects } from "@zhiyin/contract";
import { GuardedPermissionEngine, type Action } from "../src/index.js";

const nothing: ActionEffects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};

const clean = { outsideContent: false, privateWithinReach: false };

function acting(
  owner: "built-in" | "shipped",
  effects: Partial<ActionEffects>,
  said: Pick<Action, "asksEachTime"> = {},
): Action {
  return {
    kind: "tool",
    owner: owner === "built-in" ? "built-in" : "mcp",
    ...(owner === "shipped" ? { builtInConnection: true as const } : {}),
    name: "any_tool",
    arguments: {},
    action: "Do something",
    target: "somewhere",
    command: "any_tool({})",
    effects: { ...nothing, ...effects },
    conversation: clean,
    ...said,
  };
}

const decide = (action: Action) => new GuardedPermissionEngine().decide(action);

/**
 * Each tool that marks a call to be asked every time, with the effects its
 * code declares for that call.
 */
const marked: [string, "built-in" | "shipped", Partial<ActionEffects>][] = [
  [
    "a git commit, branch or stash in the folder",
    "shipped",
    { reads: "workspace", changes: "workspace-for-good", runs: "full-access" },
  ],
  [
    "a git commit, branch or stash whose repository reaches past the folder",
    "shipped",
    { reads: "elsewhere", changes: "elsewhere", runs: "full-access" },
  ],
  [
    "a Python script whose environment is made first",
    "shipped",
    {
      reads: "workspace",
      changes: "workspace",
      sends: "service",
      runs: "sealed",
    },
  ],
  [
    "adding packages to a Python environment",
    "shipped",
    {
      reads: "app",
      changes: "app",
      sends: "service",
      runs: "sealed",
      lasting: true,
    },
  ],
  [
    "creating a Python environment",
    "shipped",
    { changes: "app", sends: "service", lasting: true },
  ],
  [
    "removing a Python environment",
    "shipped",
    { reads: "app", changes: "app" },
  ],
  [
    "rebuilding a Python environment",
    "shipped",
    { reads: "app", changes: "app", sends: "service", lasting: true },
  ],
  [
    "moving a file outside the workspace to the Recycle Bin",
    "built-in",
    { reads: "elsewhere", changes: "elsewhere" },
  ],
  [
    "deleting a workspace file for good",
    "built-in",
    { reads: "workspace", changes: "workspace-for-good" },
  ],
  [
    "moving a file into or out of the workspace",
    "built-in",
    { reads: "elsewhere", changes: "elsewhere" },
  ],
  [
    "a shell command",
    "built-in",
    {
      reads: "elsewhere",
      changes: "elsewhere",
      sends: "chosen",
      runs: "full-access",
      brings: "outside",
    },
  ],
];

describe("a call its tool's code marks to be asked every time", () => {
  it.each(marked)(
    "%s is asked about, and no grant covers it",
    async (_case, owner, effects) => {
      expect(
        await decide(acting(owner, effects, { asksEachTime: true })),
      ).toMatchObject({ outcome: "ask", covers: "never" });
    },
  );

  it("is asked about even when what it declares would run without asking", async () => {
    const contained = acting("built-in", { reads: "workspace" });

    expect(await decide(contained)).toMatchObject({ outcome: "allow" });
    expect(await decide({ ...contained, asksEachTime: true })).toMatchObject({
      outcome: "ask",
      covers: "never",
    });
  });

  it("keeps why it would be asked anyway, for the card to say", async () => {
    expect(
      await decide(
        acting(
          "built-in",
          { reads: "elsewhere", changes: "elsewhere" },
          { asksEachTime: true },
        ),
      ),
    ).toMatchObject({ outcome: "ask", covers: "never", why: "outside-folder" });
  });

  it("is asked about from a connection a person added, whatever the person said of the tool in Settings", async () => {
    expect(
      await decide({
        ...acting("built-in", {}),
        owner: "mcp",
        personSays: "only-reads",
        asksEachTime: true,
      }),
    ).toMatchObject({ outcome: "ask", covers: "never" });
  });
});
