/**
 * What the plugin directory's marks are as a conversation goes on: the start
 * of its requests keeps the marks it started with, so the provider's cache
 * holds when the person sets a connector up, and the model hears of the
 * change in a `readiness` notice, once (ADR 0016).
 */

import { describe, expect, it } from "vitest";
import type { DirectoryReadiness, SetupSuggestion } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { noteReadiness } from "../src/context/directory-readiness.js";
import type { ModelHistory } from "../src/context/model-history.js";
import { harnessNotice } from "../src/turn/notices.js";
import {
  answerTo,
  overCatalog,
  startOf,
  toolNames,
  type MadeUpPlugin,
} from "./catalog-fixture.js";

const research: MadeUpPlugin = {
  id: "research",
  connectors: ["Tavily — Searches the web."],
  skills: [{ id: "sources", description: "Find sources.", text: "Cite them." }],
};

/** The plugin directory a request starts with, as the model reads it. */
function directoryOf(request: ModelRequest | undefined): unknown {
  const told = request?.messages.find(
    (message) =>
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.startsWith("Plugins the person enabled"),
  )?.content as string;
  return JSON.parse(told.slice(told.indexOf("[{")));
}

/** What a tool answered, without the fence round it. */
function unfenced(answer: string): unknown {
  return JSON.parse(
    answer.replace(/^<tool-output[^>]*>|<\/tool-output>$/g, ""),
  );
}

const writing: MadeUpPlugin = {
  id: "writing",
  skills: [{ id: "plain", description: "Write plainly.", text: "Be brief." }],
};

function readinessNotices(request: ModelRequest | undefined): string[] {
  return (request?.messages ?? []).flatMap((message) =>
    message.role === "user" &&
    typeof message.content === "string" &&
    message.content.includes('<zhiyin-notice kind="readiness">')
      ? [message.content]
      : [],
  );
}

describe("the directory's marks as a conversation goes on", () => {
  it("keeps the start of the requests byte for byte after a key is added, and tells the model once in the next request", async () => {
    let marks: DirectoryReadiness = {
      research: { needs: { "research/tavily": "key" } },
    };
    const fixture = overCatalog({
      plugins: [research],
      readiness: () => marks,
      script: () => ({ text: "Done." }),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Search the web for the tide times.");
    marks = { research: {} };
    await fixture.loop.start(taskId, "I added the key.");
    await fixture.loop.start(taskId, "Search now.");

    const [first, second, third] = fixture.requests;
    expect(directoryOf(first)).toEqual([
      expect.objectContaining({
        id: "research",
        needs: { "research/tavily": "key" },
      }),
    ]);
    expect(startOf(second)).toBe(startOf(first));
    expect(startOf(third)).toBe(startOf(first));
    expect(readinessNotices(first)).toEqual([]);
    expect(readinessNotices(second)).toEqual([
      harnessNotice(
        "readiness",
        "What these plugins and their connectors need has changed since the plugin directory was sent. This holds in place of the directory's marks for them:\n- research: research/tavily needs nothing now.",
      ),
    ]);
    expect(second?.messages.at(-1)?.content).toBe(readinessNotices(second)[0]);
    expect(readinessNotices(third)).toHaveLength(1);
  });

  it("tells the model a plugin was switched on and still waits for a key, its start as it was", async () => {
    let marks: DirectoryReadiness = {
      research: { needs: { "research/tavily": "key" }, switchedOff: true },
    };
    const fixture = overCatalog({
      // Another plugin is on, so the catalog's tools are offered throughout.
      plugins: [research, writing],
      readiness: () => marks,
      script: () => ({ text: "Done." }),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Search the web.");
    marks = { research: { needs: { "research/tavily": "key" } } };
    await fixture.loop.start(taskId, "I switched Research on.");

    const [first, second] = fixture.requests;
    expect(directoryOf(first)).toEqual([
      expect.objectContaining({
        id: "research",
        needs: { "research/tavily": "key" },
        switchedOff: true,
      }),
      expect.objectContaining({ id: "writing" }),
    ]);
    expect(startOf(second)).toBe(startOf(first));
    expect(readinessNotices(second)).toEqual([
      harnessNotice(
        "readiness",
        "What these plugins and their connectors need has changed since the plugin directory was sent. This holds in place of the directory's marks for them:\n- research: switched on.",
      ),
    ]);
  });

  it("tells the model to stop and say what a connector needs and where, before any way around it", async () => {
    const fixture = overCatalog({
      plugins: [research],
      script: () => ({ text: "Done." }),
    });
    await fixture.loop.start(await fixture.loop.createTask(), "Search.");

    const told = JSON.stringify(fixture.requests[0]?.messages);
    for (const sentence of [
      "The person does each under Connectors on that plugin's page in Plugins, where they switch a plugin on too.",
      "None of these is broken or out of service, and none should be called so.",
      "When a task would use such a connector, or a plugin switched off, stop before any way around it: tell the person, in their own words, what it needs and where, all of it in one message, and show them the place with suggest_setup.",
      "Offer another way only as a choice for them to make, and never get around a site's limits or blocks.",
    ])
      expect(told).toContain(sentence);
  });

  it("says nothing while the marks stay as the conversation started with them", async () => {
    const fixture = overCatalog({
      plugins: [research],
      readiness: () => ({ research: { needs: { "research/tavily": "key" } } }),
      script: () => ({ text: "Done." }),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Hello.");
    await fixture.loop.start(taskId, "Again.");

    expect(readinessNotices(fixture.requests[1])).toEqual([]);
  });
});

/** A conversation's history holding these notices, keeping what is added. */
function historyHolding(notices: string[]): ModelHistory {
  return {
    latestNotice: () => notices.at(-1),
    notice: async (kind: "readiness", text: string) => {
      notices.push(harnessNotice(kind, text));
    },
  } as unknown as ModelHistory;
}

describe("telling the model what changed", () => {
  const sent: DirectoryReadiness = {
    research: { needs: { "research/tavily": "key" } },
  };
  const now = [
    {
      id: "research",
      name: "Research",
      purpose: "Find sources.",
      includes: { skills: [], specialists: [], connectors: [], toolkits: [] },
    },
  ];

  it("tells it again when the conversation no longer holds the notice, as after a condensing took it away", async () => {
    const notices: string[] = [];

    await noteReadiness(historyHolding(notices), now, sent);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("research/tavily needs nothing now");
  });

  it("says the marks hold again once a change is undone after it was told", async () => {
    const notices: string[] = [];
    const history = historyHolding(notices);
    await noteReadiness(history, now, sent);

    await noteReadiness(
      history,
      [{ ...now[0]!, needs: { "research/tavily": "key" } }],
      sent,
    );

    expect(notices.at(-1)).toBe(
      harnessNotice(
        "readiness",
        "Every plugin and connector is again as the plugin directory marks it.",
      ),
    );
  });
});

describe("the setup card", () => {
  const card: SetupSuggestion = {
    plugin: { id: "research", name: "Research", switchedOff: true },
    connector: {
      id: "research/tavily",
      name: "Tavily",
      needs: "key",
      setup: { url: "https://app.tavily.com/home", keyName: "API key" },
    },
  };

  it("is offered whenever a plugin is listed, and answers that the card was shown and what it asked", async () => {
    const fixture = overCatalog({
      plugins: [{ ...research, switchedOff: true }],
      connectorSetup: (id) => (id === "research/tavily" ? card : undefined),
      script: (request) =>
        request === 1
          ? {
              calls: [
                {
                  name: "suggest_setup",
                  id: "setup-1",
                  args: { id: "research/tavily" },
                },
              ],
            }
          : { text: "Switch on Research and add a Tavily key." },
    });
    const taskId = await fixture.loop.createTask();
    await fixture.loop.start(taskId, "Search the web.");

    expect(toolNames(fixture.requests[0])).toContain("suggest_setup");
    expect(unfenced(answerTo(fixture.requests[1], "setup-1"))).toEqual({
      ok: true,
      shown:
        "The person was shown a card asking them to switch on Research and add Tavily's API key, on Research's page in Plugins, with a button that opens it.",
    });
    const action = fixture.loop
      .snapshot()
      .tasks.find((task) => task.id === taskId)
      ?.actions.find((item) => item.toolName === "suggest_setup");
    expect(action).toMatchObject({
      status: "completed",
      readOnly: true,
      approval: { by: "no-approval-needed" },
      effects: { reads: "none", changes: "none", sends: "none" },
      setup: card,
    });
  });

  it("is refused for a connector with nothing to set up, and shows no card", async () => {
    const fixture = overCatalog({
      plugins: [research],
      connectorSetup: () => undefined,
      script: (request) =>
        request === 1
          ? {
              calls: [
                {
                  name: "suggest_setup",
                  id: "setup-1",
                  args: { id: "research/tavily" },
                },
              ],
            }
          : { text: "Done." },
    });
    const taskId = await fixture.loop.createTask();
    await fixture.loop.start(taskId, "Search the web.");

    expect(answerTo(fixture.requests[1], "setup-1")).toContain(
      "There is nothing to set up for “research/tavily”",
    );
    expect(
      fixture.loop
        .snapshot()
        .tasks.find((task) => task.id === taskId)
        ?.actions.some((item) => item.setup),
    ).toBe(false);
  });
});
