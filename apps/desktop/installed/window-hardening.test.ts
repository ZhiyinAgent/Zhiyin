/**
 * What the window itself may do, asked of the running app. The window draws
 * what models write, so it is given nothing a page could ask a browser for,
 * and its page cannot be pointed somewhere else.
 */
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { closeEverything, launch } from "./launch.js";

afterEach(closeEverything);

describe("the running app's window", () => {
  it("is refused every permission a page can ask for", async () => {
    const { window } = await launch();

    const answers = await window.evaluate(async () => ({
      notifications: await Notification.requestPermission(),
      microphone: await navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then(
          () => "granted",
          () => "denied",
        ),
    }));

    expect(answers).toEqual({ notifications: "denied", microphone: "denied" });
  });

  it("runs sandboxed, with no Node or Electron within reach of its page", async () => {
    const { app, window } = await launch();

    // The page's own process, as Windows started it: a renderer left out of
    // Chromium's sandbox is started with --no-sandbox.
    const renderer = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId(),
    );
    const startedWith = execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${renderer}").CommandLine`,
    ])
      .toString()
      .split(/\s+/);
    const reachable = await window.evaluate(() => {
      const page = globalThis as unknown as Record<string, unknown>;
      const bridge = page["zhiyin"] as Record<string, unknown>;
      return {
        require: typeof page["require"],
        process: typeof page["process"],
        module: typeof page["module"],
        Buffer: typeof page["Buffer"],
        // The bridge hands over functions that send one command each, never
        // the channel itself.
        bridge: [
          ...new Set(Object.values(bridge).map((value) => typeof value)),
        ],
      };
    });

    expect(startedWith).toContain("--type=renderer");
    expect(startedWith).toContain("--enable-sandbox");
    expect(startedWith).not.toContain("--no-sandbox");
    expect(reachable).toEqual({
      require: "undefined",
      process: "undefined",
      module: "undefined",
      Buffer: "undefined",
      bridge: ["function"],
    });
  });

  it("runs no script but its own: neither one written into the page nor one from the web", async () => {
    const { window } = await launch();

    const outcome = await window.evaluate(async () => {
      const refused: string[] = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        refused.push(event.blockedURI),
      );
      const page = window as unknown as Record<string, unknown>;
      const written = document.createElement("script");
      written.textContent = "window.__written = true;";
      document.head.append(written);
      const fetched = document.createElement("script");
      fetched.src = "https://example.com/planted.js";
      const loaded = new Promise<string>((resolve) => {
        fetched.onload = () => resolve("loaded");
        fetched.onerror = () => resolve("refused");
      });
      document.head.append(fetched);
      const remote = await loaded;
      written.remove();
      fetched.remove();
      return { ran: page["__written"] === true, remote, refused };
    });

    expect(outcome.ran).toBe(false);
    expect(outcome.remote).toBe("refused");
    expect(outcome.refused).toEqual(
      expect.arrayContaining(["inline", "https://example.com/planted.js"]),
    );
  });

  it("stays on its own page when told to go to another", async () => {
    const { window } = await launch();
    const own = window.url();

    await window.evaluate(() => {
      globalThis.location.href = "https://example.com/";
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect(window.url()).toBe(own);
    await expect(
      window.evaluate(() => document.getElementById("root") !== null),
    ).resolves.toBe(true);
  });

  it("opens no other window", async () => {
    const { app, window } = await launch();

    const opened = await window.evaluate(
      () => globalThis.open("https://example.com/") === null,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect(opened).toBe(true);
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
  });

  it("keeps its own address when a page part names another base for its links", async () => {
    const { window } = await launch();

    const base = await window.evaluate(() => {
      const before = document.baseURI;
      const planted = document.createElement("base");
      planted.href = "https://example.com/";
      document.head.append(planted);
      const after = document.baseURI;
      planted.remove();
      return { before, after };
    });

    expect(base.after).toBe(base.before);
  });
});
