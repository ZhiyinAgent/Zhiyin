/**
 * What a full history costs to save and load.
 *
 * Every commit writes the whole workspace, so the cost of one keystroke's worth
 * of change grows with everything ever kept. That is fine until it is not, and
 * "not" arrives silently. These bounds are measured at a stated target size so
 * the day it stops being fine is a failing test rather than a slow app.
 *
 * The target: 200 conversations, each with 40 messages and 20 recorded actions.
 * That is a heavy year of use, not a synthetic maximum.
 */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot, WorkspaceTask } from "@zhiyin/contract";
import { FileSessions } from "../src/index.js";

const CONVERSATIONS = 200;
const MESSAGES_EACH = 40;
const ACTIONS_EACH = 20;

/*
 * Measured 2026-09-10 on a Windows 11 laptop at the target size: save 23 ms,
 * load 25 ms, one further commit 19 ms, file 8.4 MiB.
 *
 * The time budgets are deliberately loose against those numbers, because the
 * suite runs everything at once and a stopwatch that fails under load teaches
 * nothing. They are still tight enough that the thing worth catching - a whole
 * history being rewritten several times per commit, or per-turn work becoming
 * quadratic - fails here. The size budget can be tight, since it is not a race.
 */
const SAVE_BUDGET_MS = 500;
const LOAD_BUDGET_MS = 500;
const FILE_BUDGET_MIB = 16;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-history-size-"));
  roots.push(root);
  return root;
}

function conversation(index: number): WorkspaceTask {
  return {
    id: `task-${index}`,
    title: `Conversation ${index}`,
    titleSource: "generated",
    updatedAt: "2026-09-10T12:00:00.000Z",
    updatedLabel: "Today",
    messages: Array.from({ length: MESSAGES_EACH }, (_, turn) => ({
      id: `task-${index}-message-${turn}`,
      role: turn % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `Paragraph ${turn} of conversation ${index}. `.repeat(20),
      sequence: turn,
    })),
    actions: Array.from({ length: ACTIONS_EACH }, (_, step) => ({
      id: `task-${index}-action-${step}`,
      action: "Read a workspace file",
      description: "Look at what the project already says.",
      target: `docs/reference/note-${step}.md`,
      sequence: MESSAGES_EACH + step,
      status: "completed" as const,
      evidence: `The file describes step ${step}. `.repeat(10),
    })),
    phase: {
      kind: "completed" as const,
      outcome: { title: "Response complete", summary: "Done." },
    },
  };
}

const full: WorkspaceSnapshot = {
  runtime: { tasks: "available", capabilities: "available" },
  selectedTaskId: "task-0",
  tasks: Array.from({ length: CONVERSATIONS }, (_, index) =>
    conversation(index),
  ),
  mcpServers: [],
  usage: { status: "unavailable", reason: "No usage recorded." },
};

describe("FileSessions at the documented history size", () => {
  it("saves and reloads a full history within its measured budget", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);

    const savedAt = Date.now();
    await sessions.saveWorkspace(full);
    const saveMs = Date.now() - savedAt;

    const loadedAt = Date.now();
    const restored = await sessions.loadWorkspace();
    const loadMs = Date.now() - loadedAt;

    const bytes = (await stat(join(root, "workspace.json"))).size;

    expect(restored?.tasks).toHaveLength(CONVERSATIONS);
    expect({
      saveWithinBudget: saveMs <= SAVE_BUDGET_MS,
      loadWithinBudget: loadMs <= LOAD_BUDGET_MS,
      fileWithinBudget: bytes <= FILE_BUDGET_MIB * 1024 * 1024,
    }).toEqual({
      saveWithinBudget: true,
      loadWithinBudget: true,
      fileWithinBudget: true,
    });
  });

  /**
   * One more turn on one conversation rewrites all two hundred. This is the
   * cost that is actually paid during a turn, and the one that would make the
   * app feel slow long before a startup did.
   */
  it("commits one further change to a full history within its measured budget", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    await sessions.saveWorkspace(full);

    const startedAt = Date.now();
    await sessions.saveWorkspace({ ...full, selectedTaskId: "task-7" });
    const commitMs = Date.now() - startedAt;

    expect(commitMs).toBeLessThanOrEqual(SAVE_BUDGET_MS);
  });
});
