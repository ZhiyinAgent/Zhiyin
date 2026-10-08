/**
 * Spelling: the person's choice, saved with their other choices, applied to
 * the spellchecker at startup and whenever it changes, and shown in Settings
 * with how far each language has got.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHANNEL, type AppEvent } from "@zhiyin/contract";
import { FileSessions } from "@zhiyin/session";
import { Spelling, type SpellcheckEngine } from "@zhiyin/spelling";
import { Core } from "../../src/index.js";
import { loopFrom, stubDependencies } from "./support.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function checked(root: string) {
  const said: string[] = [];
  const events: AppEvent[] = [];
  let answer: (
    code: string,
    outcome: "ready" | "unavailable",
  ) => void = () => {};
  const engine: SpellcheckEngine = {
    setEnabled: (enabled) => said.push(enabled ? "on" : "off"),
    setLanguages: (codes) => said.push(`languages ${codes.join(",")}`),
    onLanguage: (listener) => {
      answer = listener;
    },
  };
  const app = loopFrom({
    ...stubDependencies((event) => events.push(event)),
    sessions: new FileSessions(root),
    spelling: new Spelling({
      engine,
      shelf: { place: async () => "placed" as const },
      systemLanguages: ["fr-FR", "zh-Hans-CN"],
    }),
  });
  await app.initialize();
  return { app, said, events, answer: (code: string) => answer(code, "ready") };
}

async function root() {
  const folder = await mkdtemp(join(tmpdir(), "zhiyin-spelling-"));
  roots.push(folder);
  return folder;
}

describe("spelling", () => {
  it("checks the Windows languages and English until the person chooses, then each choice", async () => {
    const { app, said } = await checked(await root());

    expect(said).toEqual(["languages fr,en-US", "on"]);
    expect(app.snapshot().spellingChoice).toBeUndefined();
    expect(app.snapshot().spelling?.languages.map(({ code }) => code)).toEqual([
      "fr",
      "en-US",
    ]);

    await app.setSpelling({ enabled: true, languages: ["fr", "es"] });
    await app.setSpelling({ enabled: false, languages: ["fr", "es"] });

    expect(said.slice(2)).toEqual(["languages fr,es", "on", "off"]);
    expect(app.snapshot().spelling?.enabled).toBe(false);
  });

  it("is the same after a restart", async () => {
    const folder = await root();
    const before = await checked(folder);
    await before.app.setSpelling({ enabled: false, languages: ["de"] });
    await before.app.shutdown();

    const { app, said } = await checked(folder);

    expect(said).toEqual(["off"]);
    expect(app.snapshot().spellingChoice).toEqual({
      enabled: false,
      languages: ["de"],
    });
  });

  it("tells the window when a language's dictionary has been read", async () => {
    const { app, events, answer } = await checked(await root());
    events.length = 0;

    answer("fr");

    expect(app.snapshot().spelling?.languages).toEqual([
      { code: "fr", status: "ready" },
      { code: "en-US", status: "loading" },
    ]);
    expect(events.length).toBeGreaterThan(0);
  });

  it("is chosen from the window only as on or off and a short list of languages", async () => {
    const { app } = await checked(await root());
    const core = new Core({
      workspace: app,
      ownership: { claim: async () => {}, release: async () => {} },
      viewChecks: { answer: () => {}, abandon: () => {} },
      commands: {
        runningCommands: () => [],
        commandOutput: async () => undefined,
        stopCommandForPerson: async () => {},
        onCommandsChanged: () => {},
      },
      chooseFolder: async () => undefined,
      chooseSaveLocation: async () => undefined,
      openExternal: async () => {},
      openPath: async () => {},
      showInFolder: async () => {},
      dataFolder: "C:/data",
      version: "1.0.0",
    });

    await core.receive(CHANNEL.setSpelling, [
      { enabled: true, languages: ["it"] },
    ]);
    expect(app.snapshot().spellingChoice).toEqual({
      enabled: true,
      languages: ["it"],
    });
    for (const wrong of [
      [],
      [{ enabled: true, languages: [] }],
      [{ enabled: "yes", languages: ["it"] }],
      [{ enabled: true, languages: "it" }],
      [{ enabled: true, languages: ["it", "it"] }],
      [
        {
          enabled: true,
          languages: Array.from({ length: 80 }, (_, i) => `x${i}`),
        },
      ],
    ])
      await expect(core.receive(CHANNEL.setSpelling, wrong)).rejects.toThrow();
  });
});
