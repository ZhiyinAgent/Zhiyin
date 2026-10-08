/**
 * Connectors whose service uses the standard sign-in instead of a pasted key.
 * The person signs in from the connector's settings, in their own browser; the
 * sign-in is kept in the credential store and refreshed without them. A
 * connector that is not signed in is never offered to the model, and nothing a
 * conversation does opens a browser or registers Zhiyin anywhere.
 */

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ManagedMcpServers,
  connectHttpMcpServer,
  type McpCredentialStore,
} from "../src/index.js";
import {
  browserThatSignsIn,
  signInService,
  type SignInService,
} from "./sign-in-service.js";

/** Windows' credential store: at most 1,280 characters an entry. */
class LimitedCredentials implements McpCredentialStore {
  readonly entries = new Map<string, string>();
  async get(id: string) {
    return this.entries.get(id);
  }
  async set(id: string, value: string) {
    if (value.length > 1280) throw new Error("Longer than the platform limit");
    this.entries.set(id, value);
  }
  async delete(id: string) {
    this.entries.delete(id);
  }
}

const services: SignInService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});

async function setUp(
  options: {
    readonly tokenLength?: number;
    readonly registers?: boolean;
    readonly openBrowser?: (url: string) => Promise<void>;
  } = {},
) {
  const service = await signInService(options);
  services.push(service);
  const credentials = new LimitedCredentials();
  const openBrowser = vi.fn(options.openBrowser ?? browserThatSignsIn);
  const directory = await mkdtemp(join(tmpdir(), "zhiyin-sign-in-"));
  const servers = new ManagedMcpServers(
    directory,
    connectHttpMcpServer,
    credentials,
    [],
    async () => [
      { id: "work/tracker", name: "Tracker", url: service.url, enabled: true },
    ],
    Date.now,
    { openBrowser, timeoutMs: 5_000 },
  );
  const state = () => servers.check("work/tracker");
  return { service, credentials, openBrowser, servers, state, directory };
}

/** The model calling the service's one tool. */
async function search(servers: ManagedMcpServers) {
  const [tool] = await servers.availableTools();
  if (!tool) throw new Error("The model was offered no tool.");
  return servers.execute(tool.name, {});
}

describe("a connector with the standard sign-in", () => {
  it("offers to sign in, and offers the model none of its tools until then", async () => {
    const { servers, state, openBrowser, service } = await setUp();

    expect(await state()).toMatchObject({
      status: "unauthorized",
      signIn: true,
      credential: { status: "none" },
      toolCount: 0,
    });
    expect(await servers.availableTools()).toEqual([]);
    expect(openBrowser).not.toHaveBeenCalled();
    expect(service.registrations()).toBe(0);
  });

  it("asks for a key, not a sign-in, when the service accepts only apps registered in advance", async () => {
    const { state } = await setUp({ registers: false });

    const checked = await state();

    expect(checked).toMatchObject({
      status: "unauthorized",
      reason:
        "This server refused the access token. Save a current token to sign in again.",
    });
    expect(checked.signIn).toBeUndefined();
  });

  it("tells a test of a new address that its service has its own sign-in", async () => {
    const { servers, service, openBrowser } = await setUp();

    expect(
      await servers.test({
        id: "work/new",
        name: "New",
        url: service.url,
        enabled: true,
      }),
    ).toEqual({
      ok: false,
      reason:
        "This service has its own sign-in. Save the connector, then sign in to it.",
      needs: "sign-in",
    });
    expect(openBrowser).not.toHaveBeenCalled();
    expect(service.registrations()).toBe(0);
  });

  it("signs in through the person's browser and then offers its tools", async () => {
    const { servers, state, openBrowser, credentials, directory } =
      await setUp();
    await state();

    expect(await servers.signIn("work/tracker")).toEqual({
      status: "signed-in",
    });

    expect(openBrowser).toHaveBeenCalledOnce();
    expect(await state()).toMatchObject({
      status: "connected",
      credential: { status: "signed-in" },
      tools: [{ name: "search", enabled: true }],
    });
    expect((await servers.availableTools()).length).toBe(1);
    // The tokens are in the credential store, and nowhere in Zhiyin's files.
    expect([...credentials.entries.values()].join("")).toContain("access-1");
    expect(
      await readFile(join(directory, "mcp-connections.json"), "utf8").catch(
        () => "",
      ),
    ).not.toContain("access-1");
  });

  it("keeps a sign-in longer than one credential store entry holds", async () => {
    const { servers, state } = await setUp({ tokenLength: 3_000 });
    await state();

    expect(await servers.signIn("work/tracker")).toEqual({
      status: "signed-in",
    });
    expect(await state()).toMatchObject({ status: "connected" });
  });

  it("refreshes an ended token without the person, and keeps its tools", async () => {
    const { servers, state, service, openBrowser } = await setUp();
    await state();
    await servers.signIn("work/tracker");

    service.expireTokens();

    expect(await search(servers)).toMatchObject({ ok: true });
    expect(await state()).toMatchObject({
      status: "connected",
      credential: { status: "signed-in" },
    });
    expect(openBrowser).toHaveBeenCalledOnce();
  });

  it("withdraws its tools and asks to sign in again when the refresh is refused", async () => {
    const { servers, state, service, credentials } = await setUp();
    await state();
    await servers.signIn("work/tracker");

    service.expireTokens();
    service.refuseRefresh();

    expect(await search(servers)).toEqual({
      ok: false,
      reason: "Sign in to use this connector.",
    });
    expect(await servers.states()).toMatchObject([
      {
        status: "unauthorized",
        signIn: true,
        credential: { status: "none" },
        toolCount: 0,
      },
    ]);
    expect(await state()).toMatchObject({
      status: "unauthorized",
      signIn: true,
      credential: { status: "none" },
      toolCount: 0,
    });
    expect(await servers.availableTools()).toEqual([]);
    expect(credentials.entries.size).toBe(0);
  });

  it("forgets the sign-in when the person signs out", async () => {
    const { servers, state, credentials } = await setUp();
    await state();
    await servers.signIn("work/tracker");

    await servers.clearToken("work/tracker");

    expect(await state()).toMatchObject({
      status: "unauthorized",
      credential: { status: "none" },
    });
    expect(credentials.entries.size).toBe(0);
  });

  it("saves nothing when the person cancels while the browser is open", async () => {
    const { servers, state, credentials } = await setUp({
      openBrowser: async () => {},
    });
    await state();
    const cancel = new AbortController();

    const signingIn = servers.signIn("work/tracker", cancel.signal);
    await vi.waitFor(() => expect(credentials.entries.size).toBe(0));
    cancel.abort();

    expect(await signingIn).toEqual({ status: "cancelled" });
    expect(await state()).toMatchObject({ credential: { status: "none" } });
    expect(credentials.entries.size).toBe(0);
  });

  it("says so when the person declines at the service", async () => {
    const { servers, state, service } = await setUp();
    await state();
    service.declineSignIn();

    expect(await servers.signIn("work/tracker")).toMatchObject({
      status: "failed",
      reason: expect.stringMatching(/declined/),
    });
    expect(await state()).toMatchObject({ credential: { status: "none" } });
  });

  it("never opens a sign-in page that is not secure", async () => {
    const { servers, state, service, openBrowser } = await setUp();
    await state();
    service.signInPageAt("http://example.com/authorize");

    expect(await servers.signIn("work/tracker")).toEqual({
      status: "failed",
      reason:
        "The service's sign-in page is not a secure address, so it was not opened.",
    });
    expect(openBrowser).not.toHaveBeenCalled();
  });
});
