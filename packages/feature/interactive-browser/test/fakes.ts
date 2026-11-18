/**
 * The conversations' browsers' fake, for this package's tests and those of
 * the packages above it (ADR 0002). It starts no browser.
 */

import type {
  ConversationBrowsers,
  InteractiveBrowser,
  WorkspaceUploads,
} from "../src/index.js";
import type { WorkspacePreview } from "../src/workspace-preview.js";

/**
 * What a test may give the fake: any of its answers, and as much of the
 * folder's preview and uploads as the test is about.
 */
export type BrowserAnswers = Partial<
  Omit<InteractiveBrowser, "preview" | "uploads">
> & {
  readonly preview?: Partial<WorkspacePreview>;
  readonly uploads?: Partial<WorkspaceUploads>;
};

/**
 * A browser that is closed and unavailable: what it is asked to do does
 * nothing, and it has no page, frame, preview or download to show. `answers`
 * replaces any of those answers.
 */
export function fakeBrowser(answers: BrowserAnswers = {}): InteractiveBrowser {
  const { preview, uploads, ...rest } = answers;
  return {
    preview: preview as WorkspacePreview | undefined,
    uploads: uploads as WorkspaceUploads | undefined,
    refresh: async () => {},
    availability: async () => ({
      available: false as const,
      reason: "No browser in this fixture",
    }),
    state: () => ({
      status: "closed" as const,
      url: "",
      title: "",
      loading: false,
    }),
    lastFrame: () => undefined,
    automation: () => undefined,
    takeStoppedDownloads: () => [],
    markAgentAction: () => {},
    onAgentAction: () => () => {},
    watch: async () => {},
    onState: () => () => {},
    onFrame: () => () => {},
    open: async () => {},
    navigate: async () => {},
    back: async () => {},
    forward: async () => {},
    reload: async () => {},
    pointer: async () => {},
    typeText: async () => {},
    pressKey: async () => {},
    scroll: async () => {},
    copy: async () => "",
    cut: async () => "",
    previewNetwork: () => undefined,
    allowAddresses: () => [],
    takeRefused: () => [],
    whileAnswering: <T>(work: () => Promise<T>) => work(),
    takeStoppedScripts: () => undefined,
    prepareFor: async () => {},
    leaveByHistory: async () => undefined,
    downloadsKept: () => {},
    close: async () => {},
    ...rest,
  };
}

/**
 * One browser per conversation, made by `browserFor` the first time the
 * conversation asks and kept until it is forgotten, as the app's are.
 */
export function fakeBrowsers(
  browserFor: (conversationId: string) => InteractiveBrowser = () =>
    fakeBrowser(),
): ConversationBrowsers {
  const browsers = new Map<string, InteractiveBrowser>();
  return {
    browser: (conversationId) => {
      let browser = browsers.get(conversationId);
      if (!browser) {
        browser = browserFor(conversationId);
        browsers.set(conversationId, browser);
      }
      return browser;
    },
    close: async (conversationId) => browsers.get(conversationId)?.close(),
    forget: async (conversationId) => {
      const browser = browsers.get(conversationId);
      browsers.delete(conversationId);
      await browser?.close();
    },
    closeAll: async () => {
      await Promise.all(
        [...browsers.values()].map((browser) => browser.close()),
      );
    },
  };
}
