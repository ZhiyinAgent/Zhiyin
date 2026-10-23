/**
 * The app goes online through Chromium's network (ADR 0004), which reads
 * Windows' certificates and proxy settings, not through Node's. Seen from the
 * other end, a model request arrives as Chromium sends it. A build that is not
 * installed can be told to use Node's, for tools that trace or replay a run.
 * A variable that turns Node's certificate checks off does not reach
 * Chromium's.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import {
  createServer as createSecureServer,
  type Server as SecureServer,
} from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists } from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import {
  closeEverything,
  launch,
  plantHistory,
  temporaryDataDirectory,
} from "./launch.js";

const servers: (Server | SecureServer)[] = [];
const run = promisify(execFile);

afterEach(async () => {
  await closeEverything();
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

const oneConversation = JSON.stringify({
  preferences: { onboarded: true, interests: ["research"] },
  recentWorkspaces: [],
  selectedTaskId: "t1",
  tasks: [
    {
      ...emptyConversationLists,
      id: "t1",
      title: "Ask something",
      titleSource: "generated",
      updatedAt: "2026-10-20T09:00:00.000Z",
      updatedLabel: "Now",
      messages: [],
      phase: { kind: "draft" },
    },
  ],
} satisfies SavedWorkspace);

/** A model that answers "Hi", recording who sent each request. */
async function model() {
  const senders: string[] = [];
  const server = createServer((request, response) => {
    senders.push(String(request.headers["user-agent"]));
    request.resume();
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { id: "gen-1", choices: [{ index: 0, delta: { content: "Hi" } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ])
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { senders, endpoint: `http://127.0.0.1:${port}/v1/chat/completions` };
}

describe("the app's own requests", () => {
  it.each([
    ["Chromium's network", {}, "Chrome/"],
    [
      "Node's network when a test asks for it",
      { ZHIYIN_TEST_NODE_NETWORK: "1" },
      "node",
    ],
  ])("go through %s", async (_network, switches, sender) => {
    const { senders, endpoint } = await model();
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, oneConversation);
    const { window } = await launch({
      dataDirectory,
      apiKey: "sk-or-network-check",
      environment: {
        ZHIYIN_MODEL: "z-ai/glm-5.3-flash",
        ZHIYIN_MODEL_ENDPOINT: endpoint,
        ...switches,
      },
    });
    await window
      .getByText("Ask something")
      .first()
      .waitFor({ state: "visible", timeout: 60_000 });

    await window.evaluate(() =>
      (
        window as unknown as {
          zhiyin: { sendMessage(id: string, text: string): Promise<void> };
        }
      ).zhiyin.sendMessage("t1", "Hello"),
    );
    await window
      .getByText("Hi", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });

    expect(senders.length).toBeGreaterThan(0);
    // Chromium names itself in each request; Node's fetch sends "node".
    for (const seen of senders) expect(seen).toContain(sender);
  });
});

/**
 * A certificate for 127.0.0.1 that nothing trusts, made by the OpenSSL that
 * comes with Git for Windows.
 */
async function selfSigned(folder: string) {
  const { stdout } = await run("git", ["--exec-path"]);
  // <Git>/mingw64/libexec/git-core
  const openssl = join(stdout.trim(), "..", "..", "bin", "openssl.exe");
  const key = join(folder, "key.pem");
  const cert = join(folder, "cert.pem");
  await run(openssl, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
    "-keyout",
    key,
    "-out",
    cert,
  ]);
  return { key: await readFile(key), cert: await readFile(cert) };
}

/**
 * The same model as above over HTTPS with a certificate nothing trusts,
 * counting the requests that got through and the connections refused.
 */
async function untrustedModel(folder: string) {
  const seen = { requests: 0, refused: 0 };
  const server = createSecureServer(
    await selfSigned(folder),
    (request, response) => {
      seen.requests += 1;
      request.resume();
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { id: "gen-1", choices: [{ index: 0, delta: { content: "Hi" } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ])
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end("data: [DONE]\n\n");
    },
  );
  server.on("tlsClientError", () => {
    seen.refused += 1;
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { seen, endpoint: `https://127.0.0.1:${port}/v1/chat/completions` };
}

describe("a model host whose certificate nothing trusts", () => {
  it.each([
    ["Chromium's network refuses it", {}, false],
    [
      "Node's network, used only when a test asks for it, would accept it",
      { ZHIYIN_TEST_NODE_NETWORK: "1" },
      true,
    ],
  ])(
    "with NODE_TLS_REJECT_UNAUTHORIZED=0 set: %s",
    async (_case, switches, reached) => {
      const dataDirectory = await temporaryDataDirectory();
      const { seen, endpoint } = await untrustedModel(dataDirectory);
      await plantHistory(dataDirectory, oneConversation);
      const { window } = await launch({
        dataDirectory,
        apiKey: "sk-or-network-check",
        environment: {
          ZHIYIN_MODEL: "z-ai/glm-5.3-flash",
          ZHIYIN_MODEL_ENDPOINT: endpoint,
          NODE_TLS_REJECT_UNAUTHORIZED: "0",
          ...switches,
        },
      });
      await window
        .getByText("Ask something")
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });

      await window.evaluate(() =>
        (
          window as unknown as {
            zhiyin: { sendMessage(id: string, text: string): Promise<void> };
          }
        ).zhiyin.sendMessage("t1", "Hello"),
      );
      await expect
        .poll(() => seen.requests + seen.refused, { timeout: 30_000 })
        .toBeGreaterThan(0);

      // A refused connection carries no request, and none follows it.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(seen.requests > 0).toBe(reached);
      expect(seen.refused > 0).toBe(!reached);
    },
  );
});
