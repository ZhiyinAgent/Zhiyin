/**
 * The app at the smallest window it says it supports.
 *
 * A DOM test renders a component at whatever size jsdom pretends to be, which
 * is not a size at all. These measure the real window: what the person can
 * reach, and whether the things on one row sit on one row.
 */

import { describe, expect, it, afterEach } from "vitest";
import {
  closeEverything,
  launch,
  plantHistory,
  shows,
  temporaryDataDirectory,
} from "./launch.js";

afterEach(closeEverything);

/** Enough conversations that the list is taller than the window can hold. */
const busy = JSON.stringify({
  version: 1,
  preferences: { onboarded: true, interests: ["writing"] },
  runtime: { tasks: "available", capabilities: "available" },
  selectedTaskId: "t1",
  tasks: Array.from({ length: 12 }, (_, index) => ({
    id: `t${index + 1}`,
    title: `Conversation number ${index + 1}`,
    titleSource: "generated",
    updatedAt: "2026-09-10T09:00:00.000Z",
    updatedLabel: "Yesterday",
    messages: [
      { id: `t${index}-m0`, role: "user", text: "A question", sequence: 0 },
    ],
    actions: [],
    artifacts: [
      {
        path: "page.html",
        name: "page.html",
        change: "created",
        bytes: 2048,
        updatedAt: "2026-09-10T09:00:00.000Z",
      },
    ],
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
  })),
  skills: [],
  subagents: [],
  mcpServers: [],
  usage: { status: "unavailable", reason: "None." },
});

const minimum = { width: 720, height: 480 };

async function atMinimumSize() {
  const dataDirectory = await temporaryDataDirectory();
  await plantHistory(dataDirectory, busy);
  const launched = await launch({ dataDirectory });
  await shows(
    launched.window.getByText("Conversation number 1").first(),
    "a saved conversation",
  );
  await launched.app.evaluate(async ({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
  }, minimum);
  await new Promise((resolve) => setTimeout(resolve, 600));
  return launched;
}

/**
 * At this width the sidebar is a drawer, so it has to be opened before there is
 * anything to measure. Measuring it closed reports zero for everything and
 * passes for the wrong reason.
 */
async function withDrawerOpen() {
  const launched = await atMinimumSize();
  await launched.window
    .getByRole("button", { name: "Open navigation" })
    .click({ timeout: 10_000 });
  await launched.window
    .getByRole("complementary", { name: "Primary navigation" })
    .waitFor({ state: "visible", timeout: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  return launched;
}

/** Settings lives behind the preferences row's menu. */
async function openSettings(
  window: Awaited<ReturnType<typeof launch>>["window"],
) {
  await window
    .getByRole("button", { name: "Open navigation" })
    .click({ timeout: 10_000 });
  await window
    .getByRole("complementary", { name: "Primary navigation" })
    .waitFor({ state: "visible", timeout: 10_000 });
  await window
    .getByRole("button", { name: /app menu/i })
    .first()
    .click({ timeout: 10_000 });
  await window.getByText("Model").first().click({ timeout: 10_000 });
  await window
    .getByRole("region", { name: "Model", exact: true })
    .waitFor({ state: "visible", timeout: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function openInstructions(
  window: Awaited<ReturnType<typeof launch>>["window"],
) {
  await window.getByRole("button", { name: "Open navigation" }).click();
  await window
    .getByRole("button", { name: /app menu/i })
    .first()
    .click();
  await window.getByRole("menuitem", { name: "Custom instructions" }).click();
  await window
    .getByRole("region", { name: "Custom instructions" })
    .waitFor({ state: "visible" });
}

describe("the app at its minimum supported window", () => {
  it("puts everything on the top row on the same centre line", async () => {
    const { window } = await atMinimumSize();

    const centres = await window.evaluate(() => {
      const centre = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return box.height > 0 ? Math.round(box.top + box.height / 2) : null;
      };
      return {
        navigation: centre('button[aria-label$=" navigation"]'),
        title: centre('header[aria-label="Task header"] > :first-child'),
        actions: centre('header[aria-label="Task header"] > :last-child'),
      };
    });

    expect(centres.navigation).not.toBeNull();
    expect(centres.title).toBe(centres.navigation);
    expect(centres.actions).toBe(centres.navigation);
  });

  it("lets the conversation list be scrolled to its end", async () => {
    const { window } = await withDrawerOpen();

    const list = await window.evaluate(() => {
      // The list the "Recent" heading sits at the top of.
      const element = Array.from(document.querySelectorAll("aside span")).find(
        (label) => label.textContent === "Recent",
      )?.parentElement?.parentElement;
      if (!element) return null;
      return {
        taller: element.scrollHeight > element.clientHeight,
        scrolls: ["auto", "scroll"].includes(
          getComputedStyle(element).overflowY,
        ),
      };
    });

    expect(list?.taller).toBe(true);
    expect(list?.scrolls).toBe(true);
  });

  it("keeps the preferences menu reachable however many conversations there are", async () => {
    const { window } = await withDrawerOpen();

    const profile = await window.evaluate(() => {
      const element = document.querySelector(
        'button[aria-label="Open app menu"]',
      )?.parentElement;
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        drawn: box.height > 0,
        onScreen: box.bottom <= window.innerHeight + 1 && box.top >= -1,
      };
    });

    expect(profile).toEqual({ drawn: true, onScreen: true });
  });

  it("leaves nothing off the side of the window", async () => {
    const { window } = await atMinimumSize();

    const escaping = await window.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.width > 0 &&
            (box.right > window.innerWidth + 1 || box.left < -1)
          );
        })
        .map((element) => element.className.toString().slice(0, 60)),
    );

    expect(escaping).toEqual([]);
  });

  it("draws the settings page inside the window rather than beside it", async () => {
    const { window } = await atMinimumSize();
    await openSettings(window);

    const panel = await window.evaluate(() => {
      const element = document.querySelector<HTMLElement>(
        'section[aria-label="Model"]',
      );
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        width: Math.round(box.width),
        left: Math.round(box.left),
        right: Math.round(box.right),
        viewport: window.innerWidth,
      };
    });

    expect(panel).not.toBeNull();
    // It fills the window it is in, give or take its own padding, rather than
    // being squeezed into whatever is left beside a column that is not there.
    expect(panel!.left).toBeLessThanOrEqual(4);
    expect(panel!.width).toBeGreaterThan(panel!.viewport * 0.9);
  });

  it("keeps the settings page from running off the side", async () => {
    const { window } = await atMinimumSize();
    await openSettings(window);

    const escaping = await window.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.width > 0 &&
            (box.right > window.innerWidth + 1 || box.left < -1)
          );
        })
        .map((element) => element.className.toString().slice(0, 60)),
    );

    expect(escaping).toEqual([]);
  });

  it("keeps the custom instructions editor and save button reachable at minimum size", async () => {
    const { window } = await atMinimumSize();
    await openInstructions(window);

    const editor = window.getByRole("textbox", { name: "Your instructions" });
    await editor.fill("Reply in French.");
    await window
      .getByRole("button", { name: "Save instructions" })
      .scrollIntoViewIfNeeded();
    const bounds = await window.evaluate(() => {
      const field = document.querySelector<HTMLElement>(
        'textarea[aria-label="Your instructions"]',
      );
      const save = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Save instructions"),
      );
      if (!field || !save) return null;
      const input = field.getBoundingClientRect();
      const action = save.getBoundingClientRect();
      return {
        inputInside: input.left >= 0 && input.right <= window.innerWidth,
        saveInside: action.left >= 0 && action.right <= window.innerWidth,
        saveVisible:
          action.top >= -1 && action.bottom <= window.innerHeight + 1,
      };
    });

    expect(bounds).toEqual({
      inputInside: true,
      saveInside: true,
      saveVisible: true,
    });
  });

  it("puts the app's name beside the button that opened the drawer, not under it", async () => {
    const { window } = await withDrawerOpen();

    const row = await window.evaluate(() => {
      const centre = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
          centre: Math.round(box.top + box.height / 2),
          left: Math.round(box.left),
          right: Math.round(box.right),
        };
      };
      return {
        button: centre('button[aria-label$=" navigation"]'),
        logo: centre(
          'aside[aria-label="Primary navigation"] img[alt="Zhiyin"]',
        ),
      };
    });

    expect(row.button).not.toBeNull();
    expect(row.logo).not.toBeNull();
    // Same row.
    expect(row.logo!.centre).toBe(row.button!.centre);
    // And clear of it, rather than overlapping.
    expect(row.logo!.left).toBeGreaterThanOrEqual(row.button!.right);
  });

  it("does not draw the floating button over the settings page's own heading", async () => {
    const { window } = await atMinimumSize();
    await openSettings(window);

    const overlap = await window.evaluate(() => {
      const button = document
        .querySelector('button[aria-label$=" navigation"]')
        ?.getBoundingClientRect();
      const label = document
        .querySelector(".instrument-label")
        ?.getBoundingClientRect();
      if (!button || !label) return null;
      const horizontal = button.right > label.left && button.left < label.right;
      const vertical = button.bottom > label.top && button.top < label.bottom;
      return horizontal && vertical;
    });

    expect(overlap).toBe(false);
  });
});
