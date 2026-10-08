/**
 * Spelling is checked in every language the app ships a dictionary for, from
 * the dictionaries it ships, and a word it underlines is corrected from the
 * right-click menu.
 *
 * Whether Chromium accepts a dictionary placed for it, by the name it asks
 * for, is not something a test of the parts can show; neither is whether the
 * menu Electron opens carries what Chromium knew about the word clicked. Every
 * launch here is offline for dictionaries, so one that loads came from the app.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists, type SpellingState } from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import { bundledDictionaries } from "@zhiyin/spelling";
import {
  closeEverything,
  launch,
  plantHistory,
  shows,
  temporaryDataDirectory,
  type Launched,
} from "./launch.js";
import type { Locator } from "playwright-core";

const servers: Server[] = [];

afterEach(async () => {
  await closeEverything();
  for (const server of servers.splice(0)) server.close();
});

/**
 * A dictionary server that answers nothing and keeps every request, so a
 * test sees each dictionary the app asked for instead of inferring it.
 */
async function dictionaryServer() {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(request.url ?? "");
    response.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, asked };
}

function checkedIn(languages: readonly string[]): string {
  return JSON.stringify({
    preferences: { onboarded: true, interests: ["research"] },
    recentWorkspaces: [],
    selectedTaskId: "t1",
    spellingChoice: { enabled: true, languages },
    tasks: [
      {
        ...emptyConversationLists,
        id: "t1",
        title: "Notes",
        titleSource: "manual",
        updatedAt: "2026-10-07T09:00:00.000Z",
        updatedLabel: "Now",
        messages: [],
        phase: { kind: "draft" },
      },
    ],
  } satisfies SavedWorkspace);
}

async function launchCheckingIn(
  languages: readonly string[],
  options: {
    readonly locale?: string;
    readonly dictionaryServer?: string;
  } = {},
) {
  const dataDirectory = await temporaryDataDirectory();
  await plantHistory(dataDirectory, checkedIn(languages));
  return launch({ dataDirectory, ...options });
}

/** What the core last told the window about spelling. */
async function spellingShown(launched: Launched): Promise<SpellingState> {
  return launched.window.evaluate(async () => {
    type Seen = { spelling?: SpellingState };
    const held = window as unknown as {
      zhiyin: {
        onAppEvent(
          handler: (event: { kind: string; data: Seen }) => void,
        ): () => void;
        frontendReady(): Promise<void>;
      };
    };
    return new Promise<SpellingState>((resolve, reject) => {
      const stop = held.zhiyin.onAppEvent((event) => {
        if (event.kind !== "workspaceSnapshot" || !event.data.spelling) return;
        stop();
        resolve(event.data.spelling);
      });
      // Attaching again sends the whole workspace, spelling with it.
      held.zhiyin.frontendReady().catch(reject);
    });
  });
}

async function untilSettled(launched: Launched): Promise<SpellingState> {
  const deadline = Date.now() + 30_000;
  let shown = await spellingShown(launched);
  while (
    shown.languages.some(({ status }) => status === "loading") &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    shown = await spellingShown(launched);
  }
  return shown;
}

type ShownItem = { readonly label?: string; readonly click: () => void };

/**
 * Keeps each right-click menu instead of opening it, as the person would see
 * it; choosing an item runs what the person choosing it would run.
 */
async function keepMenus(launched: Launched): Promise<void> {
  await launched.app.evaluate(({ Menu }) => {
    const kept: Electron.Menu[] = [];
    (globalThis as unknown as { keptMenus: Electron.Menu[] }).keptMenus = kept;
    Menu.prototype.popup = function (this: Electron.Menu) {
      kept.push(this);
    };
  });
}

async function lastMenu(launched: Launched): Promise<readonly string[]> {
  return launched.app.evaluate(() => {
    const kept = (globalThis as unknown as { keptMenus: Electron.Menu[] })
      .keptMenus;
    return (kept.at(-1)?.items ?? []).map((item) =>
      item.type === "separator" ? "—" : item.label,
    );
  });
}

async function choose(launched: Launched, label: string): Promise<void> {
  await launched.app.evaluate((_electron, label) => {
    const kept = (globalThis as unknown as { keptMenus: Electron.Menu[] })
      .keptMenus;
    const item = kept.at(-1)?.items.find((each) => each.label === label);
    if (!item) throw new Error(`The menu has no ${label}.`);
    (item as unknown as ShownItem).click();
  }, label);
}

/** Types into the message box as a person would. */
async function typeMessage(launched: Launched, text: string) {
  const box = launched.window.getByRole("textbox", { name: "Message Zhiyin" });
  await shows(box, "the message box");
  await box.fill("");
  await box.pressSequentially(text);
  return box;
}

/** Right-clicks the first line of the box just after the text `before`. */
async function rightClickAfter(box: Locator, before: string): Promise<void> {
  const point = await box.evaluate((element, before) => {
    const style = getComputedStyle(element);
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) throw new Error("No canvas to measure the text with.");
    measure.font = style.font;
    return {
      x: parseFloat(style.paddingLeft) + measure.measureText(before).width + 6,
      y:
        parseFloat(style.paddingTop) + (parseFloat(style.lineHeight) || 20) / 2,
    };
  }, before);
  await box.click({ button: "right", position: point });
}

/**
 * Types `text`, then right-clicks the word after `before` until the menu
 * offers `suggestion`. A word is checked after the caret leaves it and marked
 * a moment later. A right-click before then finds no misspelled word and puts
 * the caret in the word, after which only typing has it checked again, so
 * each try types the text afresh and waits longer.
 */
async function menuOffering(
  launched: Launched,
  text: string,
  before: string,
  suggestion: string,
): Promise<{ readonly box: Locator; readonly menu: readonly string[] }> {
  for (let wait = 1_000; ; wait *= 2) {
    const box = await typeMessage(launched, text);
    await launched.window.waitForTimeout(wait);
    await rightClickAfter(box, before);
    const menu = await lastMenu(launched);
    if (menu.includes(suggestion) || wait >= 8_000) return { box, menu };
  }
}

describe("spelling in the installed app", () => {
  it(
    "says a language is ready when it is also the app's own, and asks no server for that one either",
    { timeout: 120_000 },
    async () => {
      const server = await dictionaryServer();
      const english = await launchCheckingIn(["en-US"], {
        locale: "en-US",
        dictionaryServer: server.url,
      });
      expect((await untilSettled(english)).languages).toEqual([
        { code: "en-US", status: "ready" },
      ]);
      await english.close();

      // Afrikaans has no Windows spellchecker, so its dictionary would be
      // fetched if the spellchecker started on it before the choice applied.
      const afrikaans = await launchCheckingIn(["en-US"], {
        locale: "af",
        dictionaryServer: server.url,
      });
      expect((await untilSettled(afrikaans)).languages).toEqual([
        { code: "en-US", status: "ready" },
      ]);
      await afrikaans.window.waitForTimeout(2_000);

      expect(server.asked).toEqual([]);
    },
  );

  it(
    "loads every bundled dictionary with nothing downloaded",
    { timeout: 120_000 },
    async () => {
      const every = [
        ...new Set(bundledDictionaries.map(({ language }) => language)),
      ];
      const server = await dictionaryServer();
      const launched = await launchCheckingIn(every, {
        dictionaryServer: server.url,
      });

      const settled = await untilSettled(launched);

      expect(server.asked).toEqual([]);
      expect(settled.enabled).toBe(true);
      expect(
        settled.languages.filter(({ status }) => status !== "ready"),
      ).toEqual([]);
      expect(settled.languages.map(({ code }) => code).sort()).toEqual(
        [...every].sort(),
      );
    },
  );

  it(
    "corrects an underlined word from the right-click menu",
    { timeout: 120_000 },
    async () => {
      const launched = await launchCheckingIn(["en-US"]);
      await untilSettled(launched);
      await keepMenus(launched);

      const { box, menu } = await menuOffering(
        launched,
        "Thsi is a note. ",
        "",
        "This",
      );
      expect(menu).toContain("This");
      expect(menu).toEqual(
        expect.arrayContaining(["Add to dictionary", "Cut", "Paste"]),
      );

      await choose(launched, "This");

      await expect.poll(() => box.inputValue()).toBe("This is a note. ");
    },
  );

  it(
    "does not underline Chinese, which no dictionary covers",
    { timeout: 120_000 },
    async () => {
      const launched = await launchCheckingIn(["en-US"]);
      await untilSettled(launched);
      await keepMenus(launched);
      // Once the English word before it is marked, the Chinese has been
      // checked too.
      const { box, menu } = await menuOffering(
        launched,
        "Thsi 你好世界，今天天气很好。 ",
        "",
        "This",
      );
      expect(menu).toContain("This");

      await rightClickAfter(box, "Thsi ");

      expect(await lastMenu(launched)).toEqual([
        "Cut",
        "Copy",
        "Paste",
        "—",
        "Select all",
      ]);
    },
  );
});
