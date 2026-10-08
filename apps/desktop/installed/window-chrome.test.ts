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
import { emptyConversationLists } from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import { iconCandidates } from "../src/main/icon.js";
import { TITLE_BAR } from "../src/main/title-bar.js";
import {
  closeEverything,
  launch,
  type Launched,
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
  preferences: { onboarded: true, interests: ["writing"] },
  recentWorkspaces: [],
  selectedTaskId: "t1",
  tasks: [
    {
      ...emptyConversationLists,
      id: "t1",
      title: "Yesterday's work",
      titleSource: "generated",
      updatedAt: "2026-09-10T09:00:00.000Z",
      updatedLabel: "Yesterday",
      messages: [{ id: "m1", role: "user", text: "A question", sequence: 0 }],
      phase: {
        kind: "completed",
        outcome: { title: "Done", summary: "Done." },
      },
    },
  ],
} satisfies SavedWorkspace);

async function launchUsed() {
  const dataDirectory = await temporaryDataDirectory();
  await plantHistory(dataDirectory, used);
  return launch({ dataDirectory });
}

/**
 * Waits for Windows to tell the page where its controls are. The page can show
 * its content a few milliseconds before that arrives. Controls that are never
 * reported still fail the test, after five seconds.
 */
async function controlsReported(window: Launched["window"]): Promise<void> {
  await window.waitForFunction(
    () =>
      (
        navigator as Navigator & {
          windowControlsOverlay?: { visible: boolean };
        }
      ).windowControlsOverlay?.visible === true,
    undefined,
    { timeout: 5_000 },
  );
}

/**
 * Everything that scrolls and reaches into the corner the window controls
 * take, named so a failure says where. The window's own document counts when
 * it overflows, since then it is what scrolls.
 */
function scrollersUnderControls(window: Launched["window"]): Promise<string[]> {
  return window.evaluate(() => {
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
    const scrolls = (value: string) => value === "auto" || value === "scroll";
    const found = [...document.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (!scrolls(style.overflowY) && !scrolls(style.overflowX))
          return false;
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          box.top < area.height &&
          box.right > area.width
        );
      })
      .map(
        (element) =>
          element.getAttribute("aria-label") ??
          (element.className || element.tagName),
      );
    const page = document.documentElement;
    if (page.scrollHeight > innerHeight || page.scrollWidth > innerWidth)
      found.push("the window itself");
    return found;
  });
}

/**
 * Resizes the window - to the smallest it allows when given no size - and
 * waits for the page to have taken the new width.
 */
async function sized(app: Launched["app"], size?: readonly [number, number]) {
  const window = await app.firstWindow();
  const before = await window.evaluate(() => innerWidth);
  await app.evaluate(({ BrowserWindow }, given) => {
    const shown = BrowserWindow.getAllWindows()[0]!;
    const [width, height] = given ?? shown.getMinimumSize();
    shown.setSize(width!, height!);
  }, size);
  await window.waitForFunction((width) => innerWidth !== width, before);
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
   * Windows keeps drawing minimize, maximize and close; what the app takes
   * over is the bar they sit on, which is the app's own top bar. The page is
   * told where that bar ends, and it has to be the height the app paints -
   * otherwise the controls sit off-centre, or over the app.
   */
  it("leaves the window controls to Windows, on the bar the app paints", async () => {
    const { window } = await launchUsed();
    await shows(window.getByText("Yesterday's work").first(), "the app");
    await controlsReported(window).catch(() => undefined);

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
    await controlsReported(window).catch(() => undefined);

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

  /*
   * The corner the controls take is the top bar's, on every page. A page that
   * scrolls from the window's top edge carries its content, its sticky headers
   * and its scrollbar under the controls as it moves. So no surface that
   * scrolls may reach into that corner, at the size the window opens at or the
   * smallest it allows.
   */
  it("lets nothing scroll under the window controls, on any page", async () => {
    const { app, window } = await launchUsed();
    await shows(window.getByText("Yesterday's work").first(), "the app");
    await controlsReported(window).catch(() => undefined);

    const fromMenu = (item: string) => async () => {
      await window.getByRole("button", { name: "Open app menu" }).click();
      await window.getByRole("menuitem", { name: item }).click();
    };
    const pages: readonly (readonly [string, () => Promise<void>])[] = [
      ["Task conversation", async () => undefined],
      [
        "Plugins",
        () => window.getByRole("button", { name: "Plugins" }).click(),
      ],
      ["Usage overview", fromMenu("Usage")],
      ["Model", fromMenu("Model")],
      ["Custom instructions", fromMenu("Custom instructions")],
      ["Settings", fromMenu("Settings")],
    ];
    const found: string[] = [];
    for (const [page, open] of pages) {
      await open();
      await shows(window.locator(`[aria-label="${page}"]`), `the ${page} page`);
      found.push(
        ...(await scrollersUnderControls(window)).map((s) => `${page}: ${s}`),
      );
      await sized(app);
      found.push(
        ...(await scrollersUnderControls(window)).map(
          (s) => `${page}, smallest window: ${s}`,
        ),
      );
      await sized(app, [1100, 750]);
    }

    expect(found).toEqual([]);
  });

  // A new task with no folder chosen has no header of its own to sit under.
  it("lets nothing scroll under the window controls in a new task with no folder", async () => {
    const { window } = await launchUsed();
    await shows(window.getByText("Yesterday's work").first(), "the app");
    await controlsReported(window).catch(() => undefined);

    await window.getByRole("button", { name: "New task" }).click();
    await shows(
      window.getByRole("log", { name: "Task conversation" }),
      "a new conversation",
    );

    expect(await scrollersUnderControls(window)).toEqual([]);
  });

  it("lets nothing scroll under the window controls on the welcome page", async () => {
    const { window } = await launch();
    await shows(window.getByRole("main"), "the welcome page");
    await controlsReported(window).catch(() => undefined);

    expect(await scrollersUnderControls(window)).toEqual([]);
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

describe("the window's theme", () => {
  /** The canvas colour the page is painting with right now. */
  const canvas = (window: Launched["window"]) =>
    window.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--zy-canvas")
        .trim(),
    );

  it("opens light when the person chose light, and follows the theme while it runs", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(
      dataDirectory,
      JSON.stringify({ ...JSON.parse(used), appearance: "light" }),
    );
    const { app, window } = await launch({ dataDirectory });
    await shows(window.getByText("Yesterday's work").first(), "the saved work");

    expect(
      await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource),
    ).toBe("light");
    expect(await canvas(window)).toBe("#f4f4f2");

    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "dark";
    });
    await window.waitForFunction(
      () => globalThis.matchMedia("(prefers-color-scheme: dark)").matches,
    );
    expect(await canvas(window)).toBe("#1b1c1e");
  });

  it("is chosen in Settings, and the window follows at once", async () => {
    const { app, window } = await launchUsed();
    await shows(window.getByText("Yesterday's work").first(), "the saved work");
    // Dark first, as on a dark system, so choosing Light is a change the
    // window has to show whichever theme the machine running the test uses.
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "dark";
    });
    await window.waitForFunction(
      () => globalThis.matchMedia("(prefers-color-scheme: dark)").matches,
    );

    await window.getByRole("button", { name: "Open app menu" }).click();
    await window.getByRole("menuitem", { name: "Settings" }).click();
    await window.getByRole("radio", { name: "Light" }).click();

    await window.waitForFunction(
      () => globalThis.matchMedia("(prefers-color-scheme: light)").matches,
    );
    expect(
      await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource),
    ).toBe("light");
    expect(await canvas(window)).toBe("#f4f4f2");
  });
});
