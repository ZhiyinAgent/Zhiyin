/**
 * Whether words stay readable over a look's pictures, measured in the running
 * app.
 *
 * Contrast over a picture depends on the picture's pixels, the opacities and
 * masks the look sets, the strength, the theme and how the window composites
 * them, so only the drawn window can answer it. Each region where words sit is
 * captured twice in the same window: with the look's pictures, and with only
 * their slots emptied, so the comparison sees what the pictures add and
 * nothing else the look draws. The measurement is in `contrast.ts`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists, lookStrengths } from "@zhiyin/contract";
import type { LookId, LookStrength } from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import { settled } from "../system-boundary/settled.js";
import { type Capture, masking } from "./contrast.js";
import {
  closeEverything,
  launch,
  type Launched,
  plantHistory,
  shows,
  temporaryDataDirectory,
} from "./launch.js";

afterEach(closeEverything);

/** A few conversations, so the side picture shows after the list. */
const conversations = Array.from({ length: 4 }, (_, index) => ({
  ...emptyConversationLists,
  id: `t${index + 1}`,
  title: index ? `Earlier work ${index}` : "Yesterday's work",
  titleSource: "generated" as const,
  updatedAt: "2026-09-10T09:00:00.000Z",
  updatedLabel: "Yesterday",
  messages: [
    {
      id: `t${index}-m0`,
      role: "user" as const,
      text: "A question",
      sequence: 0,
    },
    {
      id: `t${index}-m1`,
      role: "assistant" as const,
      text: "An answer long enough to run across most of the reading column, so the words sit where the picture would be.",
      sequence: 1,
    },
  ],
  phase: {
    kind: "completed" as const,
    outcome: { title: "Done", summary: "Done." },
  },
}));

function history(look: LookId, strength: LookStrength) {
  return JSON.stringify({
    preferences: { onboarded: true, interests: ["writing"] },
    recentWorkspaces: [],
    selectedTaskId: "t1",
    tasks: conversations,
    look: { look, strength },
  } satisfies SavedWorkspace);
}

/** The window size the measurements are recorded at. */
const size = { width: 1100, height: 750 };

/** Every slot a look puts a picture in, emptied. */
const withoutPictures = `:root[data-look] {
  --zy-look-ground: none !important;
  --zy-look-drift: none !important;
  --zy-look-side: none !important;
  --zy-look-page: none !important;
}`;

type Rect = { x: number; y: number; width: number; height: number };
type Theme = "dark" | "light";
type Scene = "conversation" | "new task";

/**
 * Where words sit, in CSS pixels: the reading column and the list's rows, with
 * the side picture after them. On the new-task page, the box around its words.
 */
function regions(window: Launched["window"], scene: Scene) {
  return window.evaluate((scene) => {
    const box = (element: Element | null | undefined) => {
      if (!element)
        throw new Error("A region to measure is not in the window.");
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const log = document.querySelector('[role="log"]');
    const entries = [...(log?.children ?? [])].map(box);
    if (scene === "new task") {
      const top = Math.min(...entries.map((entry) => entry.y));
      const left = Math.min(...entries.map((entry) => entry.x));
      const bottom = Math.max(
        ...entries.map((entry) => entry.y + entry.height),
      );
      const right = Math.max(...entries.map((entry) => entry.x + entry.width));
      return {
        words: { x: left, y: top, width: right - left, height: bottom - top },
      };
    }
    const column = box(log);
    const measure = entries[0]!;
    const list = box(
      document.querySelector('[role="list"][aria-label="Recent"]'),
    );
    const rows = document.querySelectorAll(
      '[role="list"][aria-label="Recent"] > [role="listitem"]',
    );
    const last = box(rows[rows.length - 1]);
    return {
      column: { ...column, x: measure.x, width: measure.width },
      list: { ...list, height: last.y + last.height - list.y },
    };
  }, scene);
}

const whole = (rect: Rect) => ({
  x: Math.ceil(rect.x),
  y: Math.ceil(rect.y),
  width: Math.floor(rect.width),
  height: Math.floor(rect.height),
});

/** A capture of the region once two in a row are the same. */
async function capture(launched: Launched, rect: Rect): Promise<Capture> {
  let last = "";
  for (;;) {
    await settled(launched.window);
    const shot = await launched.app.evaluate(
      async ({ BrowserWindow }, area) => {
        const image =
          await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(area);
        const size = image.getSize();
        return { ...size, bgra: image.toBitmap().toString("base64") };
      },
      whole(rect),
    );
    if (shot.bgra === last)
      return {
        width: shot.width,
        height: shot.height,
        bgra: new Uint8Array(Buffer.from(shot.bgra, "base64")),
      };
    last = shot.bgra;
  }
}

async function wearing(launched: Launched, theme: Theme) {
  await launched.app.evaluate(({ nativeTheme }, source) => {
    nativeTheme.themeSource = source;
  }, theme);
  await launched.window.waitForFunction(
    (dark) =>
      globalThis.matchMedia("(prefers-color-scheme: dark)").matches === dark,
    theme === "dark",
  );
}

/** The muted text colour the page is drawing with now. */
const muted = (window: Launched["window"]) =>
  window.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--zy-muted)";
    document.body.append(probe);
    const parts = getComputedStyle(probe).color.match(/\d+/g)!.map(Number);
    probe.remove();
    return [parts[0]!, parts[1]!, parts[2]!] as [number, number, number];
  });

/** Turns the look's pictures off or back on, in the window as it is. */
const pictures = (window: Launched["window"], shown: boolean) =>
  window.evaluate(
    ({ shown, css }) => {
      const id = "look-contrast-without-pictures";
      document.getElementById(id)?.remove();
      if (shown) return;
      const style = document.createElement("style");
      style.id = id;
      style.textContent = css;
      document.head.append(style);
    },
    { shown, css: withoutPictures },
  );

type Measured = ReturnType<typeof masking> & { readonly where: string };

/** Each region in both themes, in the given look and strength. */
async function measured(
  look: LookId,
  strength: LookStrength,
): Promise<Measured[]> {
  const dataDirectory = await temporaryDataDirectory();
  await plantHistory(dataDirectory, history(look, strength));
  const launched = await launch({ dataDirectory });
  await shows(
    launched.window.getByText("Yesterday's work").first(),
    "the saved work",
  );
  await launched.app.evaluate(({ BrowserWindow }, { width, height }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(width, height);
  }, size);
  await launched.window.waitForFunction(
    ({ width, height }) => innerWidth === width && innerHeight === height,
    size,
  );
  const results: Measured[] = [];
  for (const scene of ["conversation", "new task"] as const) {
    if (scene === "new task") {
      await launched.window
        .getByRole("button", { name: "New conversation" })
        .click();
      await shows(
        launched.window.getByRole("heading", {
          name: "What should we work on?",
        }),
        "the new-task page",
      );
    }
    for (const theme of ["dark", "light"] as const) {
      await wearing(launched, theme);
      const text = await muted(launched.window);
      // Entries rise into place as a page opens; measured before, a region
      // would be read where its words are not.
      await settled(launched.window);
      for (const [region, rect] of Object.entries(
        await regions(launched.window, scene),
      )) {
        await pictures(launched.window, false);
        const without = await capture(launched, rect);
        await pictures(launched.window, true);
        const within = await capture(launched, rect);
        results.push({
          ...masking(without, within, text, theme === "dark"),
          where: `${strength} ${theme} ${scene} ${region}`,
        });
      }
    }
  }
  await launched.close();
  return results;
}

/**
 * The floors, from the measurements recorded in ADR 0028: muted text keeps
 * WCAG AA over the worst pixel behind it, and the pictures keep at least this
 * share of the text's contrast in every region at every strength.
 */
const floor = { wcag: 4.5, kept: 0.85 };

describe("Dots under its words", () => {
  it("keeps muted text at AA and most of the text's contrast, in both themes and at every strength", async () => {
    const report: string[] = [];
    const failures: string[] = [];
    for (const strength of lookStrengths)
      for (const result of await measured("dots", strength)) {
        const line = `${result.where}: variation ${result.variation.toFixed(3)}, kept ${(result.kept * 100).toFixed(1)}%, muted ${result.wcag.toFixed(2)}:1 (${result.pixels} px)`;
        report.push(line);
        if (result.wcag < floor.wcag || result.kept < floor.kept)
          failures.push(line);
      }
    console.log(report.join("\n"));
    expect(failures).toEqual([]);
  }, 240_000);
});
