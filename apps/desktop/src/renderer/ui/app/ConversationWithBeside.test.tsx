import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserPanelState, PartsPanelState } from "@zhiyin/contract";
import { ConversationWithBeside } from "./ConversationWithBeside.js";

/** Each drawing of parts made, with the angles it was asked to look from. */
const drawings = vi.hoisted(() => [] as { looks: unknown[] }[]);

// WebGL is not in the test's window: the parts are drawn by a stand-in, in
// place of the module that draws them with it.
vi.mock("../parts/partView.js", () => ({
  createPartView: () => {
    const drawing = { looks: [] as unknown[] };
    drawings.push(drawing);
    return {
      parse: async () => ({ show: () => undefined, discard: () => undefined }),
      look: (orbit: unknown) => void drawing.looks.push(orbit),
      resize: () => undefined,
      dispose: () => undefined,
    };
  },
}));

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
    toBeside: () => undefined,
    choose: () => undefined,
    drawPage: async () => undefined,
    cite: () => undefined,
  } as unknown as Parameters<typeof ConversationWithBeside>[0]["viewing"];
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
  } as unknown as Parameters<typeof ConversationWithBeside>[0]["commands"];
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
      <ConversationWithBeside
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
      </ConversationWithBeside>
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

describe("the parts beside a conversation", () => {
  const commands = {} as Parameters<
    typeof ConversationWithBeside
  >[0]["commands"];

  function shown(taskId: string, parts: PartsPanelState) {
    const viewing = {
      beside: { kind: "3d" as const, shows: "parts" as const, parts },
      open: true,
      available: ["3d" as const],
      toConversation: () => undefined,
      choose: () => undefined,
      partModel: async (sequence: number) => ({
        sequence,
        data: new Uint8Array([1]),
      }),
    } as unknown as Parameters<typeof ConversationWithBeside>[0]["viewing"];
    return (
      <ConversationWithBeside
        viewing={viewing}
        taskId={taskId}
        agentWorking={false}
        id="workspace"
        commands={commands}
        act={async (operation) => {
          await operation();
        }}
      >
        <p>Conversation</p>
      </ConversationWithBeside>
    );
  }

  const gear = (sequence: number): PartsPanelState => ({
    sequence,
    parts: [{ name: "Gear", size: [30, 30, 10], valid: true }],
  });

  it("shows another conversation's parts from the first angle, not the one turned to in the last", async () => {
    const { rerender } = render(shown("first", gear(1)));
    await act(async () => {});
    const firstAngle = drawings.at(-1)?.looks.at(-1);
    fireEvent.keyDown(screen.getByRole("img"), { key: "ArrowLeft" });
    expect(drawings.at(-1)?.looks.at(-1)).not.toEqual(firstAngle);

    rerender(shown("second", gear(2)));
    await act(async () => {});

    expect(drawings.at(-1)?.looks.at(-1)).toEqual(firstAngle);
  });
});
