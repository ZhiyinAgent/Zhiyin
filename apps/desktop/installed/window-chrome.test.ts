/**
 * The window's own identity, checked in the running app.
 *
 * Whether a menu is installed, how the window controls are drawn, and whether
 * a window carries an icon are properties of a real Electron window; nothing
 * renderable can answer any of them.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { iconCandidates } from "../src/main/icon.js";
import { TITLE_BAR } from "../src/main/title-bar.js";
import {
  closeEverything,
  launch,
  plantHistory,
  shows,
  temporaryDataDirectory,
} from "./launch.js";

afterEach(closeEverything);

/** Where the built main process runs from, which is what the app resolves against. */
function mainDirectory() {
  return join(dirname(fileURLToPath(import.meta.url)), "../out/main");
}

/** Somebody who has used the app before, so it opens on a conversation. */
const used = JSON.stringify({
  version: 1,
  preferences: { onboarded: true, interests: ["writing"] },
  runtime: { tasks: "available", capabilities: "available" },
  selectedTaskId: "t1",
  tasks: [
    {
      id: "t1",
      title: "Yesterday's work",
      titleSource: "generated",
      updatedAt: "2026-09-10T09:00:00.000Z",
      updatedLabel: "Yesterday",
      messages: [{ id: "m1", role: "user", text: "A question", sequence: 0 }],
      actions: [],
      phase: {
        kind: "completed",
        outcome: { title: "Done", summary: "Done." },
      },
    },
  ],
  skills: [],
  subagents: [],
  mcpServers: [],
  usage: { status: "unavailable", reason: "None." },
});

async function launchUsed() {
  const dataDirectory = await temporaryDataDirectory();
  await plantHistory(dataDirectory, used);
  return launch({ dataDirectory });
}

describe("the running app's window chrome", () => {
  it("carries no application menu, because every page it named is in the window", async () => {
    const { app } = await launch();

    const menu = await app.evaluate(async ({ Menu }) =>
      Menu.getApplicationMenu(),
    );

    expect(menu).toBeNull();
  });

  /*
   * Windows keeps drawing minimize, maximize and close; what the app took over
   * is the bar they sit on, which is the app's own top bar. The page is told
   * where that bar ends, and it has to be the height the app paints -
   * otherwise the controls sit off-centre, or over the app.
   */
  it("leaves the window controls to Windows, on the bar the app paints", async () => {
    const { window } = await launchUsed();
    await shows(window.getByText("Yesterday's work").first(), "the app");

    const overlay = await window.evaluate(() => {
      const controls = (
        navigator as Navigator & {
          windowControlsOverlay?: {
            visible: boolean;
            getTitlebarAreaRect(): DOMRect;
          };
        }
      ).windowControlsOverlay;
      if (!controls?.visible) return null;
      const area = controls.getTitlebarAreaRect();
      return { height: area.height, width: area.width, window: innerWidth };
    });

    expect(overlay).not.toBeNull();
    expect(overlay!.height).toBe(TITLE_BAR.height);
    // The controls take the rest of the strip's width, so what the app is told
    // it may draw on stops short of the window's own edge.
    expect(overlay!.width).toBeLessThan(overlay!.window);
  });

  /*
   * The window controls are painted over the app's own top bar, so the corner
   * they occupy is a corner the app may not use. Anything the app draws there
   * is either invisible or unclickable, and which of the two it is depends on
   * how wide Windows decided the controls should be that day.
   */
  it("puts nothing a person could press under the window controls", async () => {
    const { window } = await launchUsed();
    await shows(window.getByText("Yesterday's work").first(), "the app");

    const covered = await window.evaluate(() => {
      const controls = (
        navigator as Navigator & {
          windowControlsOverlay?: {
            visible: boolean;
            getTitlebarAreaRect(): DOMRect;
          };
        }
      ).windowControlsOverlay;
      if (!controls?.visible) return ["the window controls are not shown"];
      const area = controls.getTitlebarAreaRect();
      return [...document.querySelectorAll("button, a, input, [role='tab']")]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          if (!box.width || !box.height) return false;
          return box.top < area.height && box.right > area.width;
        })
        .map(
          (element) =>
            element.getAttribute("aria-label") ??
            element.textContent?.trim() ??
            element.tagName,
        );
    });

    expect(covered).toEqual([]);
  });

  it("opens settings from the window's own shortcut, not a menu", async () => {
    const { window } = await launchUsed();
    await shows(window.getByText("Yesterday's work").first(), "the app");

    await window.keyboard.press("Control+Comma");

    await shows(
      window.getByRole("region", { name: "Model", exact: true }),
      "the settings page",
    );
  });
});

describe("the running app's icon", () => {
  it("carries its own mark rather than Electron's", async () => {
    const { app } = await launch();

    /*
     * A window's icon cannot be read back, so what is checked is the thing that
     * actually goes wrong: whether the mark is where the running app looks for
     * it. A path that resolves in the source tree and not in the built one is
     * exactly the failure this catches.
     */
    const icon = await app.evaluate(
      async ({ app: electronApp, nativeImage }, candidates) => {
        void electronApp;
        for (const candidate of candidates) {
          const image = nativeImage.createFromPath(candidate);
          if (!image.isEmpty())
            return { found: candidate, width: image.getSize().width };
        }
        return null;
      },
      iconCandidates(mainDirectory()),
    );

    expect(icon).not.toBeNull();
    expect(icon!.width).toBeGreaterThanOrEqual(16);
  });
});
