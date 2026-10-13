import { describe, expect, it } from "vitest";
import type { AppEvent } from "@zhiyin/contract";
import { actionFor } from "./appEvents.js";

describe("what a core event does to the window's state", () => {
  it("says the core is connected once it is ready", () => {
    expect(
      actionFor({ kind: "coreReady", data: { version: "0.1.0" } }),
    ).toEqual({ type: "connected" });
  });

  it("hands on what an event carries, under the name the window's state knows it by", () => {
    expect(
      actionFor({ kind: "taskSelectionChanged", data: { taskId: "task-1" } }),
    ).toEqual({ type: "selectionReceived", taskId: "task-1" });
    expect(
      actionFor({
        kind: "commandsChanged",
        data: { taskId: "task-1", commands: [] },
      }),
    ).toEqual({ type: "commandsChanged", taskId: "task-1", commands: [] });
    expect(
      actionFor({
        kind: "usageChanged",
        data: { status: "unavailable", reason: "No usage yet." },
      }),
    ).toEqual({
      type: "usageReceived",
      usage: { status: "unavailable", reason: "No usage yet." },
    });
  });

  it("leaves the workspace and its conversations to the window's copy of them", () => {
    const carried = [
      "workspaceSnapshot",
      "workspaceChanged",
      "taskChanged",
      "taskUpdated",
    ];
    for (const kind of carried)
      expect(actionFor({ kind, data: {} } as unknown as AppEvent)).toBe(
        undefined,
      );
  });
});
