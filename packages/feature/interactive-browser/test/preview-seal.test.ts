/**
 * The session's part in holding the preview (ADR 0018): it tells the
 * browser's network which address is the preview, lets the browser out only
 * after the preview can no longer run, and keeps what was allowed for the
 * preview while the browser lives. A real preview serves a real folder; the
 * browser is a stand-in that writes down each thing done to it, in order.
 */

import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { BrowserSession } from "../src/index.js";
import {
  heldBrowser as browser,
  sessionWithPreview as opened,
} from "./held-browser.js";

const folders = new TemporaryFolders();
const sessions: BrowserSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await folders.removeAll();
});

async function sessionWithPreview(made: ReturnType<typeof browser>) {
  const result = await opened(made, folders);
  sessions.push(result.session);
  return result;
}

describe("the preview, held by the browser's network", () => {
  it("is the address the open preview serves, and no other", async () => {
    const made = browser();
    const { at } = await sessionWithPreview(made);

    expect(made.isPreview(at)).toBe(true);
    expect(made.isPreview("127.0.0.1:1")).toBe(false);
    expect(made.isPreview("example.com:80")).toBe(false);
  });

  it("is no longer the preview once the preview is stopped", async () => {
    const made = browser();
    const { session, at } = await sessionWithPreview(made);

    await session.preview!.close();

    expect(made.isPreview(at)).toBe(false);
  });

  it("is left for another site only after the page is blank and the preview's pages and workers are ended", async () => {
    const made = browser();
    const { session, at } = await sessionWithPreview(made);

    await session.navigate("https://example.com/");

    expect(made.done).toEqual([
      `end http://${at}`,
      "let out",
      "go to https://example.com/",
    ]);
  });

  it("moves within the preview without being let out", async () => {
    const made = browser();
    const { session, address } = await sessionWithPreview(made);

    await session.navigate(address);

    expect(made.done).toEqual([`go to ${address}`]);
  });

  it("is left by a step back to another site as by going there", async () => {
    const made = browser({ back: "https://example.com/" });
    const { session, at } = await sessionWithPreview(made);

    await session.back();

    expect(made.done).toEqual([
      `end http://${at}`,
      "let out",
      "go to https://example.com/",
    ]);
  });

  it("steps back within the preview as any page does", async () => {
    const history: { back?: string } = {};
    const made = browser(history);
    const { session, address } = await sessionWithPreview(made);
    history.back = `${address}?page=2`;

    await session.back();

    expect(made.done).toEqual(["back"]);
  });

  it("steps back to a page that is not a website as any page does, still held", async () => {
    const made = browser({ back: "chrome-error://chromewebdata/" });
    const { session } = await sessionWithPreview(made);

    await session.back();

    expect(made.done).toEqual(["back"]);
  });

  it("reports what the held preview was refused, once", async () => {
    const made = browser();
    const { session } = await sessionWithPreview(made);
    made.refuse("https://fonts.example:443");

    expect(session.takeRefused()).toEqual(["https://fonts.example:443"]);
    expect(session.takeRefused()).toEqual([]);
  });
});

describe("the page, as the browser's network knows it", () => {
  it("is where the browser is sent, as it goes, and where it is after", async () => {
    const made = browser();
    const session = new BrowserSession({ launcher: made.launcher });
    sessions.push(session);

    await session.open("localhost:5173");

    expect(made.sentTo).toEqual(["localhost:5173 true"]);
    expect(made.pageAt("localhost:5173")).toBe(true);
    expect(made.pageAt("localhost:3000")).toBe(false);

    await session.navigate("http://192.168.1.20/");

    expect(made.sentTo).toEqual([
      "localhost:5173 true",
      "192.168.1.20:80 true",
    ]);
    expect(made.pageAt("192.168.1.20:80")).toBe(true);
    expect(made.pageAt("localhost:5173")).toBe(false);
  });
});

describe("addresses allowed for the preview", () => {
  it("are given to the browser it opens, and kept until it closes", async () => {
    const made = browser();
    const session = new BrowserSession({ launcher: made.launcher });
    sessions.push(session);

    expect(
      session.allowAddresses([
        "https://cdn.example",
        "http://api.example:8080",
      ]),
    ).toEqual([]);
    await session.open();

    expect(made.done).toContain(
      "allow https://cdn.example:443 http://api.example:8080",
    );
    expect(session.previewNetwork()).toEqual({
      sealed: false,
      allowed: ["https://cdn.example:443", "http://api.example:8080"],
    });

    await session.close();

    expect(session.previewNetwork()).toEqual({ sealed: false, allowed: [] });
  });

  it("are given at once to a browser already open", async () => {
    const made = browser();
    const { session } = await sessionWithPreview(made);

    session.allowAddresses(["https://cdn.example"]);

    expect(made.done).toEqual(["allow https://cdn.example:443"]);
    expect(session.previewNetwork()?.sealed).toBe(true);
  });

  it("are only origins: anything else is answered back and not allowed", async () => {
    const made = browser();
    const session = new BrowserSession({ launcher: made.launcher });
    sessions.push(session);

    expect(
      session.allowAddresses([
        "https://cdn.example/lib.js",
        "ftp://files.example",
        "cdn.example",
      ]),
    ).toEqual([
      "https://cdn.example/lib.js",
      "ftp://files.example",
      "cdn.example",
    ]);
    expect(session.previewNetwork()?.allowed).toEqual([]);
  });

  it("are not held by a browser that does not hold the preview", () => {
    const session = new BrowserSession({
      launcher: { ...browser().launcher, sealsPreview: false },
    });

    expect(session.previewNetwork()).toBeUndefined();
  });
});
