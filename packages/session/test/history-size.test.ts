/**
 * What a full history costs to save and load.
 *
 * A commit writes only what changed, and a launch reads only the list, so
 * neither should grow with everything ever kept. That holds until it does not,
 * and "not" arrives silently. These bounds are measured at a stated target size
 * so the day it stops holding is a failing test rather than a slow app.
 *
 * The target: 200 conversations, each with 40 messages and 20 recorded actions.
 * That is a heavy year of use, not a synthetic maximum.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot, WorkspaceTask } from "@zhiyin/contract";
import { FileSessions } from "../src/index.js";
import { savedBytes } from "./planted-history.js";

const CONVERSATIONS = 200;
const MESSAGES_EACH = 40;
const ACTIONS_EACH = 20;

/*
 * Measured 2026-09-23 on a Windows 11 laptop at the target size: the whole
 * history written at once 280-520 ms, every conversation read 30 ms, the list
 * read at launch 5 ms, one further commit 2 ms, 7.5 MiB on disk.
 *
 * Writing a whole history at once is what only recovery does, and it flushes
 * each of the two hundred files to the disk before counting it saved; that
 * flushing is most of its cost, and the price of a save surviving a power cut.
 *
 * The time budgets are deliberately loose against those numbers, because the
 * suite runs everything at once and a stopwatch that fails under load teaches
 * nothing. They are still tight enough that the thing worth catching - a whole
 * history being rewritten by one commit, or per-turn work becoming quadratic -
 * fails here. The size budget can be tight, since it is not a race.
 */
const WHOLE_HISTORY_BUDGET_MS = 3_000;
const LOAD_BUDGET_MS = 500;
const COMMIT_BUDGET_MS = 100;
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

    // A new store, so what is measured is reading the disk, not memory.
    const loadedAt = Date.now();
    const restored = await new FileSessions(root).loadWorkspace();
    const loadMs = Date.now() - loadedAt;

    const bytes = await savedBytes(root);

    expect(restored?.tasks).toHaveLength(CONVERSATIONS);
    expect({
      saveWithinBudget: saveMs <= WHOLE_HISTORY_BUDGET_MS,
      loadWithinBudget: loadMs <= LOAD_BUDGET_MS,
      fileWithinBudget: bytes <= FILE_BUDGET_MIB * 1024 * 1024,
    }).toEqual({
      saveWithinBudget: true,
      loadWithinBudget: true,
      fileWithinBudget: true,
    });
  });

  /**
   * One more change to one conversation. This is the cost that is actually
   * paid during a turn, and the one that would make the app feel slow long
   * before a startup did; rewriting all two hundred would take the time the
   * whole-history write takes, and fail here.
   */
  it("commits one further change to a full history within its measured budget", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    await sessions.saveWorkspace(full);

    const startedAt = Date.now();
    await sessions.saveWorkspace({ ...full, selectedTaskId: "task-7" });
    const commitMs = Date.now() - startedAt;

    expect(commitMs).toBeLessThanOrEqual(COMMIT_BUDGET_MS);
  });

  it("reads the list of a full history at launch within its measured budget", async () => {
    const root = await temporaryRoot();
    await new FileSessions(root).saveWorkspace(full);

    const startedAt = Date.now();
    const index = await new FileSessions(root).loadIndex();
    const launchMs = Date.now() - startedAt;

    expect(index?.conversations).toHaveLength(CONVERSATIONS);
    expect(launchMs).toBeLessThanOrEqual(COMMIT_BUDGET_MS);
  });
});
