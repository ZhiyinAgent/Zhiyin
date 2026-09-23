/**
 * Starts the real app the way a person starts it.
 *
 * Everything else in the suite composes the app out of parts. This does not:
 * it runs the built main process in Electron, with its own data folder, and
 * talks to the window the person would see. That is the only way to find the
 * things that only go wrong once the preload bridge, the renderer, and the
 * stores are all real at once.
 */

import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";
import type { ElectronApplication, Locator, Page } from "playwright-core";
import { FileSessions, type SavedWorkspace } from "@zhiyin/session";

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, "../../..");
const built = join(repository, "apps/desktop/out/main/index.js");

export type Launched = {
  readonly app: ElectronApplication;
  readonly window: Page;
  /** The app's data folder, so a test can plant or inspect what is saved. */
  readonly dataDirectory: string;
  close(): Promise<void>;
};

const opened: Launched[] = [];
const directories: string[] = [];

/** A data folder this test owns, ready to have a saved history planted in it. */
export async function temporaryDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "zhiyin-installed-"));
  directories.push(directory);
  return directory;
}

/**
 * Puts a saved history into a data folder, damaged or otherwise. A workspace
 * given as JSON is stored the way the app stores one, whatever it holds — a
 * conversation the reader will refuse included. Anything else becomes the
 * list of conversations, unreadable.
 */
export async function plantHistory(
  dataDirectory: string,
  contents: string,
): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  let workspace: unknown;
  try {
    workspace = JSON.parse(contents);
  } catch {
    const index = historyIndexFolder(dataDirectory);
    await mkdir(index, { recursive: true });
    await writeFile(join(index, "log-000001.jsonl"), contents, "utf8");
    return;
  }
  // Saving claims the folder; it is let go so the app can own it.
  const sessions = new FileSessions(dataDirectory);
  await sessions.saveWorkspace(workspace as SavedWorkspace);
  await sessions.release();
}

/** Where the list of conversations is kept in a data folder. */
export function historyIndexFolder(dataDirectory: string): string {
  return join(dataDirectory, "history", "index");
}

export async function launch(
  options: {
    readonly dataDirectory?: string;
    readonly credentialsUnavailable?: boolean;
    /** Closing browsers and connections never finishes, as a hung one would. */
    readonly connectionsNeverClose?: boolean;
    /**
     * A provider credential, for the rare test that needs a real stream rather
     * than a fixture. Left out by default and blanked below, so no ordinary run
     * can reach a provider by inheriting one from whoever started it.
     */
    readonly apiKey?: string;
  } = {},
): Promise<Launched> {
  const dataDirectory =
    options.dataDirectory ?? (await temporaryDataDirectory());
  const app = await electron.launch({
    args: [built, `--user-data-dir=${dataDirectory}`],
    env: {
      ...process.env,
      // No provider credential reaches a test run unless one was asked for, and
      // no folder is inherited from whoever is running it.
      OPENROUTER_API_KEY: options.apiKey ?? "",
      ZHIYIN_WORKSPACE: "",
      ...(options.credentialsUnavailable
        ? { ZHIYIN_TEST_CREDENTIALS_UNAVAILABLE: "1" }
        : {}),
      ...(options.connectionsNeverClose
        ? { ZHIYIN_TEST_CONNECTIONS_NEVER_CLOSE: "1" }
        : {}),
    },
  });
  const window = await app.firstWindow();
  const launched: Launched = {
    app,
    window,
    dataDirectory,
    close: async () => {
      await app.close().catch(() => undefined);
    },
  };
  opened.push(launched);
  return launched;
}

/**
 * Starts another copy against a data folder that is already owned, and answers
 * whether it got a window. A refused copy quits before it has one, so asking it
 * for a window the way an ordinary launch does would only ever report that it
 * had closed - which is the outcome, not an error.
 */
export async function launchSecondCopy(
  dataDirectory: string,
): Promise<{ readonly gotAWindow: boolean }> {
  let app: ElectronApplication;
  try {
    app = await electron.launch({
      args: [built, `--user-data-dir=${dataDirectory}`],
      env: { ...process.env, OPENROUTER_API_KEY: "", ZHIYIN_WORKSPACE: "" },
    });
  } catch {
    // It quit before it could even be attached to, which is the refusal
    // happening as fast as it can.
    return { gotAWindow: false };
  }
  try {
    await app.firstWindow({ timeout: 10_000 });
    return { gotAWindow: true };
  } catch {
    return { gotAWindow: false };
  } finally {
    await app.close().catch(() => undefined);
  }
}

/**
 * Waits for something to be on screen. Vitest's `expect` has no idea what a
 * page is, so waiting is done with the page's own API and the failure is the
 * timeout, which says what it was waiting for.
 */
export async function shows(locator: Locator, what: string): Promise<void> {
  await locator
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {
      throw new Error(`The app never showed ${what}.`);
    });
}

/** Waits for something to be gone, having first let the window settle. */
export async function hides(locator: Locator, what: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if ((await locator.count()) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The app was still showing ${what}.`);
}

export async function closeEverything(): Promise<void> {
  await Promise.all(opened.splice(0).map((item) => item.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}
