/**
 * What the model is offered and told about the held preview (ADR 0018): one
 * call allows several addresses, every address the preview was refused is
 * named in the next answer, and the browser is let out of the preview before
 * the model sends it elsewhere.
 */

import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { browserAutomation } from "../src/automation-server.js";
import type { BrowserSession } from "../src/index.js";
import { fakeAutomationServer } from "./fake-automation-server.js";
import { heldBrowser, sessionWithPreview } from "./held-browser.js";

const folders = new TemporaryFolders();
const sessions: BrowserSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await folders.removeAll();
});

async function automated(history: { back?: string } = {}) {
  const made = heldBrowser(history);
  const opened = await sessionWithPreview(made, folders);
  sessions.push(opened.session);
  const server = fakeAutomationServer([
    { name: "browser_snapshot", description: "Read the page." },
    { name: "browser_navigate_back", description: "Go back." },
  ]);
  const automation = browserAutomation(opened.session, {
    createConnection: server.createConnection,
  });
  return { ...opened, made, server, automation };
}

const text = (result: unknown) =>
  (result as { content: { type: string; text?: string }[] }).content
    .map((part) => part.text ?? "")
    .join("\n");

describe("the held preview, as the model uses it", () => {
  it("is offered a call that allows several addresses at once", async () => {
    const { automation } = await automated();

    const tools = await automation.listTools();

    expect(tools.map((tool) => tool.name)).toContain("browser_allow_addresses");
  });

  it("is told, on opening it, that the preview reaches only its own files and how to ask for more", async () => {
    const { automation } = await automated();

    const answer = text(
      await automation.callTool("browser_preview", { path: "index.html" }),
    );

    expect(answer).toContain("reaches only its own files");
    expect(answer).toContain("browser_allow_addresses");
  });

  it("allows every address asked for in one call, and says which", async () => {
    const { automation, session } = await automated();

    const answer = await automation.callTool("browser_allow_addresses", {
      addresses: ["https://cdn.jsdelivr.net", "https://fonts.gstatic.com"],
    });

    expect((answer as { isError?: boolean }).isError).toBeFalsy();
    expect(text(answer)).toContain("https://cdn.jsdelivr.net:443");
    expect(session.previewNetwork()?.allowed).toEqual([
      "https://cdn.jsdelivr.net:443",
      "https://fonts.gstatic.com:443",
    ]);
  });

  it("allows nothing when one of the addresses is not an origin, and names it", async () => {
    const { automation, session } = await automated();

    const answer = await automation.callTool("browser_allow_addresses", {
      addresses: ["https://cdn.jsdelivr.net", "https://example.com/data.json"],
    });

    expect((answer as { isError?: boolean }).isError).toBe(true);
    expect(text(answer)).toContain("https://example.com/data.json");
    expect(session.previewNetwork()?.allowed).toEqual([]);
  });

  it("allows only the addresses that were approved", async () => {
    const { automation, session } = await automated();
    const approved = await automation.inspect!("browser_allow_addresses", {
      addresses: ["https://cdn.jsdelivr.net"],
    });

    const answer = await automation.callTool(
      "browser_allow_addresses",
      { addresses: ["https://collect.example"] },
      undefined,
      approved.ok ? approved.identity : undefined,
    );

    expect((answer as { isError?: boolean }).isError).toBe(true);
    expect(session.previewNetwork()?.allowed).toEqual([]);
  });

  it("names each address the preview was refused with the next answer on it", async () => {
    const { automation, made } = await automated();
    made.refuse("https://fonts.googleapis.com:443");

    const first = text(await automation.callTool("browser_snapshot", {}));
    const second = text(await automation.callTool("browser_snapshot", {}));

    expect(first).toContain("https://fonts.googleapis.com:443");
    expect(first).toContain("browser_allow_addresses");
    // The call to make, with the addresses as they are given to it.
    expect(first).toContain(
      `browser_allow_addresses with addresses ["https://fonts.googleapis.com:443"]`,
    );
    expect(second).not.toContain("fonts.googleapis.com");
  });

  it("lets the browser out of the preview before going to another site", async () => {
    const { automation, made, server, at } = await automated();

    await automation.callTool("browser_navigate", {
      url: "https://example.com/",
    });

    expect(made.done.slice(0, 2)).toEqual([`end http://${at}`, "let out"]);
    expect(server.called()).toEqual(["browser_navigate"]);
  });

  it("goes back out of the preview by going to the page it would return to", async () => {
    const { automation, made, server, at } = await automated({
      back: "https://example.com/",
    });

    await automation.callTool("browser_navigate_back", {});

    expect(made.done.slice(0, 2)).toEqual([`end http://${at}`, "let out"]);
    expect(server.called()).toEqual(["browser_navigate"]);
    expect(server.lastArguments()).toEqual({ url: "https://example.com/" });
  });
});
