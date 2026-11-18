/**
 * A change to a file too large to copy cannot be undone, so it asks; it can
 * be allowed for the conversation by that file alone, as the conversation
 * last left it (ADR 0013). Nothing else that cannot be undone can be.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ActionEffects,
  ConversationPermission,
  ToolCallInspection,
} from "@zhiyin/contract";
import {
  GuardedPermissionEngine,
  StandingGrantRules,
  type Action,
} from "../src/index.js";

type Inspection = Extract<ToolCallInspection, { readonly ok: true }>;

const workspace = join("C:\\", "Users", "lin", "Documents", "Stand");
const scene = join(workspace, "stand.blend");
const data = join(workspace, "sales.csv");

/** A sealed-off script that changes these files with no copy taken first. */
const changing = (
  uncopied: readonly string[],
  more: Partial<ActionEffects> = {},
): ActionEffects => ({
  reads: "workspace",
  changes: "workspace-for-good",
  sends: "none",
  actsAsPerson: "none",
  runs: "sealed",
  lasting: false,
  brings: "none",
  uncopied,
  ...more,
});

const acting = (effects: ActionEffects): Action => ({
  kind: "tool",
  owner: "built-in",
  name: "blender_run_script",
  arguments: {},
  action: "Run a Blender script",
  target: "stand.blend",
  command: "blender_run_script({})",
  effects,
  conversation: { outsideContent: false, privateWithinReach: false },
});

const inspecting = (effects: ActionEffects): Inspection => ({
  ok: true,
  action: "Run a Blender script",
  target: "stand.blend",
  command: "blender_run_script({})",
  effects,
});

const decide = (effects: ActionEffects) =>
  new GuardedPermissionEngine().decide(acting(effects));

/** How each file stands now, as the agent loop reads it for the rules. */
const standing =
  (now: Readonly<Record<string, string>>) => async (path: string) =>
    now[path];

/** A grant the conversation holds for changes to `file` without a backup. */
const grantFor = (
  file: string,
  left: string,
  toolName = "blender_run_script",
): ConversationPermission => ({
  id: `rule-${file}`,
  at: "2026-11-01T00:00:00.000Z",
  kind: "uncopied-file",
  label: `Changes to ${file} without a backup`,
  toolName,
  file,
  standing: left,
});

async function grants(
  effects: ActionEffects,
  granted: readonly ConversationPermission[],
  now: Readonly<Record<string, string>> = {},
) {
  return new StandingGrantRules().grants({
    owner: "built-in",
    name: "blender_run_script",
    inspection: inspecting(effects),
    decision: await decide(effects),
    granted,
    digest: async () => undefined,
    standing: standing(now),
  });
}

describe("a change to files Zhiyin could not copy", () => {
  it("asks, saying it cannot be undone, and may be allowed for the conversation by file", async () => {
    expect(await decide(changing([scene]))).toMatchObject({
      outcome: "ask",
      covers: "uncopied-file",
      why: "cannot-undo",
    });
  });

  it("is offered its one file for the conversation, named so", async () => {
    expect(await grants(changing([scene]), [])).toEqual({
      files: {
        file: {
          kind: "uncopied-file",
          label: "Changes to stand.blend without a backup",
          toolName: "blender_run_script",
          file: scene,
        },
      },
    });
  });

  it("is covered by the grant for its file while the file is as the conversation left it", async () => {
    const held = grantFor(scene, "13000000:1730000000000");

    expect(
      await grants(changing([scene]), [held], {
        [scene]: "13000000:1730000000000",
      }),
    ).toMatchObject({ applied: held });
  });

  it("asks again once the file was changed elsewhere since", async () => {
    const held = grantFor(scene, "13000000:1730000000000");

    expect(
      await grants(changing([scene]), [held], {
        [scene]: "13500000:1730000500000",
      }),
    ).not.toHaveProperty("applied");
  });

  it("is covered whichever tool's call the grant was given on", async () => {
    const held = grantFor(scene, "1:1", "mcp__python__run_python");

    expect(
      await grants(changing([scene]), [held], { [scene]: "1:1" }),
    ).toMatchObject({ applied: held });
  });

  it("is not covered by a grant for another file", async () => {
    expect(
      await grants(changing([scene]), [grantFor(data, "1:1")], {
        [scene]: "1:1",
        [data]: "1:1",
      }),
    ).not.toHaveProperty("applied");
  });

  it("changing two files, is covered only when both are granted, and offered the one not yet granted", async () => {
    const now = { [scene]: "1:1", [data]: "2:2" };

    const one = await grants(
      changing([scene, data]),
      [grantFor(scene, "1:1")],
      now,
    );
    const both = await grants(
      changing([scene, data]),
      [grantFor(scene, "1:1"), grantFor(data, "2:2")],
      now,
    );

    expect(one).not.toHaveProperty("applied");
    expect(one.files?.file).toMatchObject({ file: data });
    expect(both).toHaveProperty("applied");
  });

  it("is offered nothing, and covered by nothing, for a file in Git's folder", async () => {
    const hook = join(workspace, ".git", "hooks", "pre-commit");

    expect(
      await grants(changing([hook]), [grantFor(hook, "1:1")], {
        [hook]: "1:1",
      }),
    ).toEqual({});
  });
});

describe("what still asks every time", () => {
  it.each([
    ["a change that cannot be undone and names no file", changing([])],
    [
      "a change to an uncopied file that also leaves something to run later",
      changing([scene], { lasting: true }),
    ],
    [
      "a change to an uncopied file by code with the person's full access",
      changing([scene], { runs: "full-access" }),
    ],
    [
      "a change to an uncopied file that also reaches outside the folder",
      changing([scene], { reads: "elsewhere" }),
    ],
    [
      "a change to an uncopied file that also acts as the person for good",
      changing([scene], { actsAsPerson: "for-good" }),
    ],
  ])("%s", async (_case, effects) => {
    expect(await decide(effects)).toMatchObject({
      outcome: "ask",
      covers: "never",
    });
    expect(
      await grants(effects, [grantFor(scene, "1:1")], { [scene]: "1:1" }),
    ).toEqual({});
  });
});

describe("a connection Zhiyin does not ship", () => {
  it("gains no file grant by saying its change is to a file Zhiyin could not copy", async () => {
    const effects = changing([scene]);
    const decision = await new GuardedPermissionEngine().decide({
      ...acting(effects),
      owner: "mcp",
      name: "mcp__scenes__save",
    });

    expect(decision).toMatchObject({ outcome: "ask", covers: "tool" });
    expect(
      await new StandingGrantRules().grants({
        owner: "mcp",
        name: "mcp__scenes__save",
        inspection: inspecting(effects),
        decision,
        granted: [grantFor(scene, "1:1", "mcp__scenes__save")],
        digest: async () => undefined,
        standing: standing({ [scene]: "1:1" }),
      }),
    ).not.toHaveProperty("applied");
  });
});
