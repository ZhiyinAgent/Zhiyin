/**
 * Onboarding switches off the built-in plugins a person did not choose, and
 * skipping it switches them all off. The model is still told they exist, so it
 * can say which one to switch on when the work needs it.
 */

import type { ModelRequest } from "@zhiyin/model-client";
import { describe, expect, it } from "vitest";
import {
  loopFrom,
  pluginStore,
  pluginView,
  stubDependencies,
} from "./support.js";

describe("a person who skipped onboarding", () => {
  it("has the model told of the built-in plugins it switched off, and how they are switched on", async () => {
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      plugins: pluginStore([
        pluginView({
          name: "engineering",
          displayName: "Full-Stack Software Engineering",
        }),
        pluginView({ name: "research", displayName: "Deep Research" }),
      ]),
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          yield { kind: "done" as const };
        },
      },
    });
    await loop.initialize();

    // "Start exploring" chooses no cards.
    await loop.configureProfile([]);
    const taskId = await loop.createTask();
    await loop.start(taskId, "Plan a trip to Kyoto.");

    const sent = JSON.stringify(requests[0]?.messages);
    expect(sent).toContain("Full-Stack Software Engineering");
    expect(sent).toContain('\\"switchedOff\\":true');
    expect(sent).toContain(
      "The person does each under Connectors on that plugin's page in Plugins, where they switch a plugin on too.",
    );
    const tools = requests[0]?.tools?.map((tool) => tool.name);
    expect(tools).not.toContain("open");
    // Nothing can be opened, but the person can be shown where to switch one on.
    expect(tools).toContain("suggest_setup");
  });
});
