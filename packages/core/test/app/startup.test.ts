/**
 * What has to be ready before the app is usable, and what can arrive later.
 *
 * Saved conversations come from a local file and are ready almost at once.
 * Connections reach across the network and may never answer. Waiting for the
 * second before showing the first means an unreachable server holds a person's
 * own history hostage.
 */

import { describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type AppEvent,
  type WorkspaceSnapshot,
} from "@zhiyin/contract";
import { stubDependencies, until, loopFrom } from "./support.js";

function gate() {
  let release = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release: () => release() };
}

const savedTask = {
  id: "task-1",
  title: "Last week's work",
  titleSource: "generated" as const,
  updatedAt: "2026-09-03T10:00:00.000Z",
  updatedLabel: "Last week",
  ...emptyConversationLists,
  messages: [
    {
      id: "message-1",
      role: "user" as const,
      text: "Summarise the report",
      sequence: 0,
    },
  ],
  actions: [],
  phase: { kind: "interrupted" as const },
};

function loopWaitingOnConnections(held: Promise<void>) {
  const events: AppEvent[] = [];
  const deps = stubDependencies((event) => events.push(event));
  const loop = loopFrom({
    ...deps,
    sessions: {
      ...deps.sessions,
      loadWorkspace: async () => ({
        runtime: {
          tasks: "available" as const,
          capabilities: "available" as const,
        },
        selectedTaskId: "task-1",
        tasks: [savedTask],
        skills: [],
        subagents: [],
        mcpServers: [],
        usage: { status: "unavailable" as const, reason: "None." },
      }),
    },
    mcp: {
      ...deps.mcp,
      states: async () => {
        await held;
        return [
          {
            id: "docs",
            name: "Project docs",
            url: "https://docs.example.test/mcp",
            enabled: true,
            status: "connected" as const,
            toolCount: 3,
          },
        ];
      },
    },
  });
  return { loop, events };
}

/**
 * A workspace whose first provider-settings read waits on `held`, as a model
 * catalogue lookup that has not answered would. Every later read answers at
 * once, with a different model, so a test can tell the two apart.
 */
function loopWaitingOnProviderSettings(held: Promise<void>) {
  const events: AppEvent[] = [];
  const deps = stubDependencies((event) => events.push(event));
  const settings = {
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    credential: { status: "missing" as const, source: "none" as const },
  };
  let reads = 0;
  let settleStartupRead = () => {};
  const startupRead = new Promise<void>((resolve) => {
    settleStartupRead = resolve;
  });
  const loop = loopFrom({
    ...deps,
    sessions: {
      ...deps.sessions,
      loadWorkspace: async () => ({
        runtime: {
          tasks: "available" as const,
          capabilities: "available" as const,
        },
        selectedTaskId: "task-1",
        tasks: [savedTask],
        skills: [],
        subagents: [],
        mcpServers: [],
        usage: { status: "unavailable" as const, reason: "None." },
      }),
    },
    model: {
      ...deps.model,
      settings: async () => {
        reads += 1;
        if (reads > 1) return { ...settings, model: "after-a-change" };
        await held;
        settleStartupRead();
        return { ...settings, model: "from-startup" };
      },
    },
  });
  return { loop, events, startupRead };
}

describe("AgentLoop startup", () => {
  it("shows saved conversations without waiting for a connection that has not answered", async () => {
    const held = gate();
    const { loop } = loopWaitingOnConnections(held.opened);

    await loop.initialize();

    expect(loop.snapshot().runtime.tasks).toBe("available");
    expect(loop.snapshot().tasks.map((task) => task.title)).toEqual([
      "Last week's work",
    ]);
    held.release();
  });

  it("brings the connections in when they answer, without a second launch", async () => {
    const held = gate();
    const { loop } = loopWaitingOnConnections(held.opened);
    await loop.initialize();
    expect(loop.snapshot().mcpServers).toEqual([]);

    held.release();

    await until(() => loop.snapshot().mcpServers.length === 1);
    expect(loop.snapshot().mcpServers[0]).toMatchObject({
      id: "docs",
      status: "connected",
    });
  });

  it("shows saved conversations without waiting for the model catalogue", async () => {
    const held = gate();
    const { loop } = loopWaitingOnProviderSettings(held.opened);

    await loop.initialize();

    expect(loop.snapshot().tasks.map((task) => task.title)).toEqual([
      "Last week's work",
    ]);
    held.release();
  });

  it("brings the provider settings in when the catalogue answers", async () => {
    const held = gate();
    const { loop, events } = loopWaitingOnProviderSettings(held.opened);
    await loop.initialize();
    expect(loop.settings.current()).toBeUndefined();

    held.release();

    await until(() =>
      events.some((event) => event.kind === "providerSettingsChanged"),
    );
    expect(loop.settings.current()).toMatchObject({ model: "from-startup" });
  });

  it("keeps settings read after a change rather than a slower read begun at startup", async () => {
    const held = gate();
    const { loop, startupRead } = loopWaitingOnProviderSettings(held.opened);
    await loop.initialize();

    await loop.settings.clearApiKey();
    held.release();
    await startupRead;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loop.settings.current()).toMatchObject({ model: "after-a-change" });
  });

  it("says so when the connections never answer, and keeps the history usable", async () => {
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      mcp: {
        ...deps.mcp,
        states: async () => {
          throw new Error("The server did not answer.");
        },
      },
    });

    await loop.initialize();

    expect(loop.snapshot().runtime.tasks).toBe("available");
    await until(() =>
      (loop.snapshot().issues ?? []).some((issue) =>
        issue.message.includes("Connections could not be loaded"),
      ),
    );
  });
});

/**
 * Damaged history is the case where doing nothing is safest and doing nothing
 * is also useless. The rule is that the bytes are kept before anything else
 * happens, the person is told what was found, and no conversation is written
 * over until they choose.
 */
describe("AgentLoop damaged history", () => {
  function loopOverDamage(damage: {
    readonly kind: "partial" | "unreadable";
    readonly readable?: number;
    readonly damaged?: number;
    readonly failsToClear?: boolean;
  }) {
    const preserved: string[] = [];
    let recovered = 0;
    let freshStart = false;
    let saved = 0;
    let written: WorkspaceSnapshot | undefined;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: async () => {
          // Once something has been written the file is no longer damaged,
          // which is what makes the next launch ordinary.
          if (written) return written;
          if (freshStart) return undefined;
          if (recovered)
            return {
              runtime: {
                tasks: "available" as const,
                capabilities: "available" as const,
              },
              selectedTaskId: "keep-1",
              tasks: [savedTask],
              skills: [],
              subagents: [],
              mcpServers: [],
              usage: { status: "unavailable" as const, reason: "None." },
            };
          throw Object.assign(new Error("damaged"), { code: "corrupted" });
        },
        // Like the real store, a save never writes over damage it was not
        // told to clear.
        saveWorkspace: async (snapshot) => {
          if (!written && !recovered && !freshStart)
            throw Object.assign(new Error("damaged"), { code: "corrupted" });
          saved += 1;
          written = snapshot;
        },
        startAfresh: async (kept) => {
          if (!preserved.includes(kept))
            throw Object.assign(new Error("not kept"), { code: "corrupted" });
          if (damage.failsToClear) throw new Error("locked");
          freshStart = true;
        },
        inspectDamage: async () =>
          damage.kind === "partial"
            ? {
                kind: "partial" as const,
                readable: damage.readable ?? 2,
                damaged: damage.damaged ?? 1,
              }
            : { kind: "unreadable" as const },
        preserveDamaged: async () => {
          const kept = `damaged-history/workspace-${preserved.length}.json`;
          preserved.push(kept);
          return kept;
        },
        recoverReadable: async () => {
          recovered += 1;
          return {
            recovered: damage.readable ?? 2,
            discarded: damage.damaged ?? 1,
            kept: "damaged-history/workspace-0.json",
          };
        },
      },
    });
    return { loop, preserved, saves: () => saved };
  }

  it("keeps the damaged history before asking anything of the person", async () => {
    const fixture = loopOverDamage({ kind: "partial" });

    await fixture.loop.initialize();

    expect(fixture.preserved).toHaveLength(1);
  });

  it("writes nothing over the damaged history until a choice is made", async () => {
    const fixture = loopOverDamage({ kind: "partial" });

    await fixture.loop.initialize();

    expect(fixture.saves()).toBe(0);
    expect(fixture.loop.snapshot().runtime.tasks).toBe("unavailable");
  });

  it("says how much can be recovered rather than telling the person to repair a file", async () => {
    const fixture = loopOverDamage({
      kind: "partial",
      readable: 5,
      damaged: 2,
    });

    await fixture.loop.initialize();

    expect(fixture.loop.snapshot().historyRecovery).toMatchObject({
      readable: 5,
      damaged: 2,
    });
  });

  it("says plainly when nothing can be recovered", async () => {
    const fixture = loopOverDamage({ kind: "unreadable" });

    await fixture.loop.initialize();

    expect(fixture.loop.snapshot().historyRecovery).toMatchObject({
      readable: 0,
    });
  });

  it("opens the conversations that survived once recovery is chosen", async () => {
    const fixture = loopOverDamage({ kind: "partial" });
    await fixture.loop.initialize();

    await fixture.loop.recoverHistory("recover");

    expect(fixture.loop.snapshot().runtime.tasks).toBe("available");
    expect(fixture.loop.snapshot().conversations).toHaveLength(1);
    expect(fixture.loop.snapshot().historyRecovery).toBeUndefined();
  });

  it("starts empty only when starting empty is what was chosen", async () => {
    const fixture = loopOverDamage({ kind: "unreadable" });
    await fixture.loop.initialize();

    await fixture.loop.recoverHistory("startFresh");

    expect(fixture.loop.snapshot().runtime.tasks).toBe("available");
    expect(fixture.loop.snapshot().tasks).toEqual([]);
    expect(fixture.preserved).toHaveLength(1);
  });

  it("keeps asking when the history could not be started afresh", async () => {
    const fixture = loopOverDamage({ kind: "unreadable", failsToClear: true });
    await fixture.loop.initialize();

    await expect(fixture.loop.recoverHistory("startFresh")).rejects.toThrow();

    expect(fixture.loop.snapshot().historyRecovery).toBeDefined();
    expect(fixture.loop.snapshot().runtime.tasks).toBe("unavailable");
    expect(fixture.saves()).toBe(0);
  });

  it("refuses to recover when there is nothing readable, and stays where it was", async () => {
    const fixture = loopOverDamage({ kind: "unreadable" });
    await fixture.loop.initialize();

    await expect(fixture.loop.recoverHistory("recover")).rejects.toThrow();

    expect(fixture.loop.snapshot().runtime.tasks).toBe("unavailable");
  });
});
