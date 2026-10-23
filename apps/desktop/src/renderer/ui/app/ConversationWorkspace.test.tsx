import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserPanelState } from "@zhiyin/contract";
import { ConversationWorkspace } from "./ConversationWorkspace.js";

const page: BrowserPanelState = {
  status: "open",
  title: "Pricing",
  url: "https://example.com/pricing",
  loading: false,
  frame: { data: "frame", width: 1280, height: 800 },
};

function viewing(open: boolean) {
  return {
    beside: { kind: "browser" as const, browser: page },
    open,
    available: ["browser" as const],
    toConversation: () => undefined,
    toWorkspace: () => undefined,
    choose: () => undefined,
    drawPage: async () => undefined,
    cite: () => undefined,
  } as unknown as Parameters<typeof ConversationWorkspace>[0]["viewing"];
}

describe("the browser beside a conversation", () => {
  const watchBrowser = vi.fn(async () => undefined);
  const commands = {
    driveBrowser: async () => undefined,
    watchBrowser,
    lookAtScene: async () => undefined,
    showDocument: async () => ({ ok: true as const }),
    closeDocument: async () => undefined,
    openDocument: async () => undefined,
    showDocumentInFolder: async () => undefined,
  } as unknown as Parameters<typeof ConversationWorkspace>[0]["commands"];
  let restore: () => void;

  beforeEach(() => {
    watchBrowser.mockClear();
    const box = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 600, height: 400 } as DOMRect);
    const density = window.devicePixelRatio;
    window.devicePixelRatio = 1;
    restore = () => {
      box.mockRestore();
      window.devicePixelRatio = density;
    };
  });

  afterEach(() => restore());

  function shown(taskId: string, open = true) {
    return (
      <ConversationWorkspace
        viewing={viewing(open)}
        taskId={taskId}
        agentWorking={false}
        id="workspace"
        commands={commands}
        act={async (operation) => {
          await operation();
        }}
      >
        <p>Conversation</p>
      </ConversationWorkspace>
    );
  }

  it("stops watching a conversation's page when another conversation is shown, and watches that one's", () => {
    const { rerender } = render(shown("first"));
    expect(watchBrowser).toHaveBeenLastCalledWith("first", {
      width: 600,
      height: 400,
    });

    rerender(shown("second"));

    expect(watchBrowser).toHaveBeenCalledWith("first", null);
    expect(watchBrowser).toHaveBeenLastCalledWith("second", {
      width: 600,
      height: 400,
    });
  });

  it("says the page's new size in pixels when the window moves to a screen of another density", () => {
    const queries: { query: string; changed?: (() => void) | undefined }[] = [];
    const matchMedia = vi.fn((query: string) => {
      const entry: { query: string; changed?: (() => void) | undefined } = {
        query,
      };
      queries.push(entry);
      return {
        addEventListener: (_: string, listener: () => void) => {
          entry.changed = listener;
        },
        removeEventListener: () => {
          entry.changed = undefined;
        },
      } as unknown as MediaQueryList;
    });
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      render(shown("first"));

      window.devicePixelRatio = 2;
      queries.at(-1)!.changed!();

      expect(watchBrowser).toHaveBeenLastCalledWith("first", {
        width: 1200,
        height: 800,
      });
      expect(queries.at(-1)!.query).toBe("(resolution: 2dppx)");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stops watching the page when the person goes back to the conversation alone, and watches it again when they return", () => {
    const { rerender } = render(shown("first"));

    rerender(shown("first", false));
    expect(watchBrowser).toHaveBeenLastCalledWith("first", null);

    rerender(shown("first", true));
    expect(watchBrowser).toHaveBeenLastCalledWith("first", {
      width: 600,
      height: 400,
    });
  });
});
