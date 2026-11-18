/**
 * What the window itself may do, asked of the running app. The window draws
 * what models write, so it is given nothing a page could ask a browser for,
 * and its page cannot be pointed somewhere else.
 */
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { closeEverything, launch, temporaryDataDirectory } from "./launch.js";

/** A one-pixel PNG. */
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

afterEach(closeEverything);

describe("the running app's window", () => {
  it("is refused the permissions a page asks for", async () => {
    const { window } = await launch();

    const answers = await window.evaluate(async () => {
      const media = (constraints: MediaStreamConstraints) =>
        navigator.mediaDevices.getUserMedia(constraints).then(
          () => "granted",
          () => "denied",
        );
      return {
        notifications: await Notification.requestPermission(),
        microphone: await media({ audio: true }),
        camera: await media({ video: true }),
        // Refused, not merely unavailable on a machine that cannot locate.
        location: await new Promise<string>((resolve) =>
          navigator.geolocation.getCurrentPosition(
            () => resolve("granted"),
            (error) =>
              resolve(
                error.code === error.PERMISSION_DENIED
                  ? "denied"
                  : `unavailable (${error.code})`,
              ),
          ),
        ),
        clipboard: await navigator.clipboard.readText().then(
          () => "granted",
          () => "denied",
        ),
      };
    });
    // What the page is told it may do, which a machine without a camera or
    // a microphone answers the same as one with them.
    const checked = await window.evaluate(async () => {
      const state = (name: string) =>
        navigator.permissions
          .query({ name: name as PermissionName })
          .then((status) => status.state);
      return {
        notifications: await state("notifications"),
        microphone: await state("microphone"),
        camera: await state("camera"),
        location: await state("geolocation"),
        clipboard: await state("clipboard-read"),
      };
    });

    expect(answers).toEqual({
      notifications: "denied",
      microphone: "denied",
      camera: "denied",
      location: "denied",
      clipboard: "denied",
    });
    expect(checked).toEqual({
      notifications: "denied",
      microphone: "denied",
      camera: "denied",
      location: "denied",
      clipboard: "denied",
    });
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

  it("loads its own files, and no picture from this computer or a network share", async () => {
    const folder = await temporaryDataDirectory();
    const picture = join(folder, "picture.png");
    await writeFile(picture, pixel);
    const onThisComputer = pathToFileURL(picture).toString();
    // The same file through this computer's administrative share, named as a
    // picture on another computer's share is: a host other than localhost
    // makes the address a network path.
    const onAShare = `file://127.0.0.1/${picture.replace(/^([A-Za-z]):/, "$1$").replaceAll("\\", "/")}`;
    const { window } = await launch();

    const outcome = await window.evaluate(
      async ([local, share]) => {
        const shown = (address: string) =>
          new Promise<string>((resolve) => {
            const image = document.createElement("img");
            image.onload = () => resolve("loaded");
            image.onerror = () => resolve("refused");
            image.src = address;
            document.body.append(image);
          });
        const script = document.querySelector<HTMLScriptElement>(
          'script[type="module"]',
        );
        const own = script ? (await fetch(script.src)).ok : false;
        return {
          own,
          local: await shown(local!),
          share: await shown(share!),
        };
      },
      [onThisComputer, onAShare],
    );

    expect(outcome).toEqual({
      own: true,
      local: "refused",
      share: "refused",
    });
  });

  it("draws no picture from the web", async () => {
    const { window } = await launch();

    const outcome = await window.evaluate(
      () =>
        new Promise<{ shown: string; refused: string }>((resolve) => {
          // Refused by the window's own rules, before any network is asked.
          document.addEventListener(
            "securitypolicyviolation",
            (event) =>
              resolve({ shown: "refused", refused: event.effectiveDirective }),
            { once: true },
          );
          const image = document.createElement("img");
          image.onload = () => resolve({ shown: "loaded", refused: "" });
          image.src = "https://example.com/picture.png";
          document.body.append(image);
        }),
    );

    expect(outcome).toEqual({ shown: "refused", refused: "img-src" });
  });

  it("stays on its own page when told to go to another", async () => {
    const { app, window } = await launch();
    const own = window.url();
    // Heard after the window's own guard, which is the first to hear it.
    await app.evaluate(({ BrowserWindow }) => {
      const page = globalThis as unknown as { leaving?: boolean };
      BrowserWindow.getAllWindows()[0]!.webContents.on(
        "will-navigate",
        (event) => (page.leaving = !event.defaultPrevented),
      );
    });

    await window.evaluate(() => {
      globalThis.location.href = "https://example.com/";
    });
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as unknown as { leaving?: boolean }).leaving,
        ),
      )
      .toBe(false);

    expect(window.url()).toBe(own);
    await expect(
      window.evaluate(() => document.getElementById("root") !== null),
    ).resolves.toBe(true);
  });

  it("opens no other window", async () => {
    const { app, window } = await launch();

    // Refused as it is asked: no window is made to be closed later.
    const opened = await window.evaluate(
      () => globalThis.open("https://example.com/") === null,
    );

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
