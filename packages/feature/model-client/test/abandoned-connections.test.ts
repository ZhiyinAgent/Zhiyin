/**
 * A request Zhiyin gives up on is closed, so the provider is told and stops
 * generating an answer nobody will read. Checked against a real local server,
 * where an abandoned connection that stays open can be seen.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderModelClient } from "../src/client.js";
import { openRouter } from "../src/providers/openrouter/provider.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  );
});

/** A provider that starts each answer, then falls silent and stays open. */
async function fallingSilent() {
  const connections = { opened: 0, closed: 0 };
  const server = createServer((_request, response) => {
    connections.opened += 1;
    response.on("close", () => {
      connections.closed += 1;
    });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({
        id: "gen-1",
        choices: [{ index: 0, delta: { content: "Hel" } }],
      })}\n\n`,
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`;
  return { connections, endpoint };
}

async function until(condition: () => boolean, withinMs: number) {
  const end = Date.now() + withinMs;
  while (!condition() && Date.now() < end)
    await new Promise((resolve) => setTimeout(resolve, 10));
}

/**
 * Reads every event `send` yields, the client's clock moved on by
 * `stallTimeoutMs` only once an attempt has passed its first words on. The
 * client's timers run on that clock alone, so a loaded machine, slow to
 * reach the server or to read its words, cannot end an attempt before it
 * started answering, which would make it a retry of another kind.
 */
async function silencedOnceAnswering(
  send: () => AsyncIterable<{ readonly kind: string }>,
  stallTimeoutMs: number,
): Promise<void> {
  const kinds: string[] = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    let settled = false;
    const sent = (async () => {
      for await (const event of send()) kinds.push(event.kind);
    })().finally(() => {
      settled = true;
    });
    sent.catch(() => undefined);
    while (!settled) {
      // A new attempt starts only after its restart is passed on, so until
      // then the clock can end nothing but the silent attempt.
      if (kinds.lastIndexOf("textDelta") > kinds.lastIndexOf("restarting"))
        await vi.advanceTimersByTimeAsync(stallTimeoutMs);
      else await new Promise((resolve) => setImmediate(resolve));
    }
    await sent;
  } finally {
    vi.useRealTimers();
  }
}

describe("an answer that falls silent partway through", () => {
  it("has its connection closed once it is given up, each attempt's included", async () => {
    const { connections, endpoint } = await fallingSilent();
    const client = new ProviderModelClient(openRouter, {
      apiKey: async () => "sk-or-test",
      model: "z-ai/glm-5.3-flash",
      modelInfo: (model) => openRouter.describe(model, {}),
      endpoint,
      stallTimeoutMs: 80,
      retry: { wait: async () => {}, random: () => 0 },
    });

    await expect(
      silencedOnceAnswering(
        () =>
          client.send({
            messages: [{ role: "user", content: "Hello" }],
            restartable: true,
          }),
        80,
      ),
    ).rejects.toMatchObject({ code: "networkFailure" });

    // The first attempt and the three restarts the policy allows.
    expect(connections.opened).toBe(4);
    // A connection still open is never closed, so only a broken run waits
    // this long.
    await until(() => connections.closed === connections.opened, 15_000);
    expect(connections.closed).toBe(connections.opened);
  });
});
