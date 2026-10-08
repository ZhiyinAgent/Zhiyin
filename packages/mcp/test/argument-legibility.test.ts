/**
 * What a connection's arguments say for themselves.
 *
 * A built-in connection describes its own calls, so Tavily reads well. Anything
 * added later gets no such treatment, and a person deciding whether to allow
 * `create_issue({"project_id":"a9f","body":"..."})` cannot tell what they are
 * agreeing to. Every MCP tool declares a schema for its inputs; that schema
 * names each parameter and usually says what it is for, and it is already held
 * for the approval identity check. Using it costs nothing and works for a
 * server nobody has seen yet.
 *
 * The schema's words belong to whoever runs the server, so they are carried as
 * that server's claim rather than as anything this app establishes.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryMcpCredentials } from "../src/index.js";
import { managed } from "./declarations.js";

const schema = {
  type: "object",
  properties: {
    project_id: {
      type: "string",
      description: "Which project the issue is filed against.",
    },
    title: { type: "string", description: "The issue's one-line summary." },
    body: { type: "string" },
  },
  required: ["project_id", "title"],
};

async function connected() {
  const servers = managed(
    await mkdtemp(join(tmpdir(), "zhiyin-mcp-args-")),
    async () => ({
      listTools: async () => [
        {
          name: "create_issue",
          description: "File an issue.",
          inputSchema: schema,
        },
      ],
      callTool: async () => ({ content: [] }),
      close: async () => {},
    }),
    new InMemoryMcpCredentials(),
  );
  await servers.declare({
    id: "tracker",
    name: "Tracker",
    url: "https://tracker.example.test/mcp",
    enabled: true,
  });
  return servers;
}

describe("an MCP call put to a person", () => {
  it("names each input and shows its value, rather than one blob of JSON", async () => {
    const servers = await connected();

    const inspection = await servers.inspect("mcp__tracker__create_issue", {
      project_id: "a9f",
      title: "Login fails on Safari",
    });

    expect(inspection.ok && inspection.invocation?.arguments).toEqual([
      expect.objectContaining({ name: "project_id", value: "a9f" }),
      expect.objectContaining({
        name: "title",
        value: "Login fails on Safari",
      }),
    ]);
  });

  it("says what each input is for, in the server's own words", async () => {
    const servers = await connected();

    const inspection = await servers.inspect("mcp__tracker__create_issue", {
      project_id: "a9f",
      title: "Login fails on Safari",
    });

    const args = inspection.ok ? (inspection.invocation?.arguments ?? []) : [];
    expect(args[0]).toMatchObject({
      described: "Which project the issue is filed against.",
    });
    expect(args[1]).toMatchObject({
      described: "The issue's one-line summary.",
    });
  });

  it("leaves an input the server did not describe undescribed, rather than inventing one", async () => {
    const servers = await connected();

    const inspection = await servers.inspect("mcp__tracker__create_issue", {
      project_id: "a9f",
      title: "Login fails on Safari",
      body: "Steps to reproduce.",
    });

    const args = inspection.ok ? (inspection.invocation?.arguments ?? []) : [];
    expect(
      args.find((item) => item.name === "body")?.described,
    ).toBeUndefined();
  });

  it("still shows an input the schema never mentioned", async () => {
    const servers = await connected();

    const inspection = await servers.inspect("mcp__tracker__create_issue", {
      project_id: "a9f",
      title: "Login fails on Safari",
      surprise: "not in the schema",
    });

    const args = inspection.ok ? (inspection.invocation?.arguments ?? []) : [];
    const surprise = args.find((item) => item.name === "surprise");
    expect(surprise?.value).toBe("not in the schema");
    expect(surprise?.described).toBeUndefined();
  });

  it("names where the call is going", async () => {
    const servers = await connected();

    const inspection = await servers.inspect("mcp__tracker__create_issue", {
      project_id: "a9f",
      title: "Login fails on Safari",
    });

    expect(inspection.ok && inspection.invocation?.via).toBe(
      "https://tracker.example.test/mcp",
    );
  });
});
