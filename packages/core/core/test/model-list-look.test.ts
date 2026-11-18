import { describe, expect, it } from "vitest";
import type { ModelListLook } from "@zhiyin/model-client";
import { lookForNewerModelList, type LogEntry } from "../src/index.js";

/**
 * Each launch looks once for a newer model list. A list taken, and a look that
 * failed, each leave a line in the diagnostic log; finding nothing newer, or
 * looking with updates switched off, leaves none.
 */

function looking(look: ModelListLook) {
  const logged: LogEntry[] = [];
  const done = lookForNewerModelList(
    { refresh: async () => look, state: () => ({ version: 42 }) },
    { record: (entry) => void logged.push(entry) },
  );
  return { logged, done };
}

describe("looking for a newer model list", () => {
  it("logs the version of a list it took", async () => {
    const { logged, done } = looking({
      at: "2026-11-01T00:00:00.000Z",
      outcome: "updated",
    });
    await done;

    expect(logged).toEqual([
      {
        level: "info",
        source: "model-list",
        message: "Model list 42 was taken.",
      },
    ]);
  });

  it("logs why no newer list was taken when the look failed", async () => {
    const { logged, done } = looking({
      at: "2026-11-01T00:00:00.000Z",
      outcome: "failed",
      reason: "The signature did not match.",
    });
    await done;

    expect(logged).toEqual([
      {
        level: "warn",
        source: "model-list",
        message: "No newer model list was taken: The signature did not match.",
      },
    ]);
  });

  it("logs nothing when there was nothing newer, or nowhere to look", async () => {
    const unchanged = looking({
      at: "2026-11-01T00:00:00.000Z",
      outcome: "unchanged",
    });
    const off = looking({ outcome: "off" });
    await unchanged.done;
    await off.done;

    expect([...unchanged.logged, ...off.logged]).toEqual([]);
  });
});
