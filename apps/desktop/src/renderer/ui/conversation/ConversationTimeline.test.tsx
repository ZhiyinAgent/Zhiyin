import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ConversationTimeline,
  type TimelineMessage,
  type TimelineTask,
} from "./ConversationTimeline.js";

type Entry = { id: string; sequence: number };

const conversation: TimelineTask<Entry, Entry, Entry> = {
  id: "conversation-1",
  messages: [
    { id: "m1", role: "user", text: "Chart last quarter's sales", sequence: 0 },
    { id: "m2", role: "assistant", text: "Here is the chart.", sequence: 4 },
  ],
  actions: [
    { id: "a1", sequence: 1 },
    { id: "a2", sequence: 2 },
  ],
  views: [{ id: "v1", sequence: 3 }],
  interactions: [],
  specialistRuns: [],
  condensings: [],
  plan: [],
  phase: { kind: "completed", outcome: { title: "Done", summary: "" } },
};

/** Pieces that say what they were given, so a test can read the order. */
const pieces = {
  actions: (actions: Entry[]) => (
    <p data-piece="">{`actions ${actions.map((action) => action.id).join(" ")}`}</p>
  ),
  view: (view: Entry) => <p data-piece="">{`view ${view.id}`}</p>,
  interaction: (interaction: Entry) => (
    <p data-piece="">{`interaction ${interaction.id}`}</p>
  ),
};

describe("ConversationTimeline", () => {
  it("counts down the provider retry from its saved deadline", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-29T10:00:00.000Z"));
      render(
        <ConversationTimeline
          task={{
            ...conversation,
            messages: [conversation.messages[0]!],
            actions: [],
            views: [],
            phase: {
              kind: "working",
              steps: [],
              note: "The model is busy. Trying again",
              retry: { readyAt: "2026-09-29T10:00:08.000Z", count: "2 of 5" },
            },
          }}
          pieces={pieces}
        />,
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        "The model is busy. Trying again in 8 sattempt 2 of 5",
      );
      act(() => vi.advanceTimersByTime(3_000));
      expect(screen.getByRole("status")).toHaveTextContent(
        "Trying again in 5 s",
      );
      act(() => vi.advanceTimersByTime(5_000));
      expect(screen.getByRole("status")).not.toHaveTextContent("in 5 s");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Trying again…attempt 2 of 5",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("says how long it has been working once it passes five seconds, and keeps counting when the conversation is shown again", () => {
    vi.useFakeTimers();
    try {
      const working = {
        ...conversation,
        id: "timed",
        messages: [conversation.messages[0]!],
        actions: [],
        views: [],
        phase: { kind: "working" as const, steps: [] },
      };
      const shown = render(
        <ConversationTimeline task={working} pieces={pieces} />,
      );
      expect(screen.getByRole("status")).toHaveTextContent(/^Working$/);
      act(() => vi.advanceTimersByTime(6_000));
      expect(screen.getByRole("status")).toHaveTextContent("Working6 s");

      shown.unmount();
      act(() => vi.advanceTimersByTime(66_000));
      render(<ConversationTimeline task={working} pieces={pieces} />);
      expect(screen.getByRole("status")).toHaveTextContent("Working1 min 12 s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps reasoning-only continuations out of the conversation while work stays visible", () => {
    const { container } = render(
      <ConversationTimeline
        task={{
          ...conversation,
          messages: [
            conversation.messages[0]!,
            {
              id: "thinking-1",
              role: "assistant",
              text: "",
              sequence: 1,
              reasoning: { text: "Search first.", status: "complete" },
            },
            {
              id: "thinking-2",
              role: "assistant",
              text: "",
              sequence: 2,
              reasoning: { text: "Check another source.", status: "streaming" },
            },
          ],
          actions: [{ id: "a1", sequence: 1.5 }],
          views: [],
          phase: { kind: "working", steps: [] },
        }}
        pieces={pieces}
      />,
    );
    expect(screen.queryByText("Search first.")).toBeNull();
    expect(screen.queryByText("Check another source.")).toBeNull();
    expect(screen.queryByText("Thought process")).toBeNull();
    expect(
      container.querySelectorAll("[aria-label='Zhiyin response']"),
    ).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Working");
    expect(screen.getByText("actions a1")).toBeVisible();
  });

  it("shows the interrupted outcome without a raw reasoning row", () => {
    render(
      <ConversationTimeline
        task={{
          ...conversation,
          messages: [
            conversation.messages[0]!,
            {
              sequence: 1,
              id: "interrupted-reasoning",
              role: "assistant",
              text: "",
              reasoning: {
                text: "Partial model notes.",
                status: "interrupted",
              },
            },
          ],
          actions: [],
          views: [],
          phase: { kind: "interrupted", reason: "Stopped by the person." },
        }}
        pieces={pieces}
      />,
    );
    expect(screen.getByText("Task stopped")).toBeVisible();
    expect(screen.getByText("Stopped by the person.")).toBeVisible();
    expect(screen.queryByText("Partial model notes.")).toBeNull();
  });

  it("draws each entry through the piece the app passes in, in the order it happened", () => {
    const { container } = render(
      <ConversationTimeline task={conversation} pieces={pieces} />,
    );

    expect(
      [...container.querySelectorAll("[data-piece]")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["actions a1 a2", "view v1"]);
  });

  /**
   * While the model writes a call, the loop says it is composing one, and that
   * sentence is only worth sending if it arrives on screen. A note with no actions and no plan
   * beside it is exactly the state a turn is in during its first round.
   */
  it("shows what a turn is composing while it waits for the call to arrive", () => {
    render(
      <ConversationTimeline
        task={{
          ...conversation,
          actions: [],
          views: [],
          plan: [],
          phase: {
            kind: "working",
            steps: [],
            note: "Composing a request: Draw chart",
          },
        }}
        pieces={pieces}
      />,
    );

    expect(screen.getByText("Composing a request: Draw chart")).toBeTruthy();
  });

  /**
   * A turn that has already done something has actions. A note drawn only when
   * there are none would, in any real session past its first round, be sent
   * and never seen.
   */
  it("shows what a turn is composing after it has already done something", () => {
    render(
      <ConversationTimeline
        task={{
          ...conversation,
          plan: [],
          phase: {
            kind: "working",
            steps: [],
            note: "Composing a request: Render diagram",
          },
        }}
        pieces={pieces}
      />,
    );

    expect(
      screen.getByText("Composing a request: Render diagram"),
    ).toBeTruthy();
  });

  it("ends each turn with its own closing piece, before the next message, saying which turn is still working", () => {
    const twoTurns: TimelineTask<Entry, Entry, Entry> = {
      ...conversation,
      messages: [
        ...conversation.messages,
        { id: "m3", role: "user", text: "Now by region", sequence: 5 },
        { id: "m4", role: "assistant", text: "Working on it.", sequence: 6 },
      ],
      phase: { kind: "working", steps: [] },
    };
    const { container } = render(
      <ConversationTimeline
        task={twoTurns}
        pieces={{
          ...pieces,
          userMessage: (message: TimelineMessage) => (
            <p data-piece="">{`message ${message.id}`}</p>
          ),
          turnEnd: (opening: TimelineMessage, running: boolean) => (
            <p data-piece="">{`end ${opening.id}${running ? " running" : ""}`}</p>
          ),
        }}
      />,
    );

    expect(
      [...container.querySelectorAll("[data-piece]")].map(
        (piece) => piece.textContent,
      ),
    ).toEqual([
      "message m1",
      "actions a1 a2",
      "view v1",
      "end m1",
      "message m3",
      "end m3 running",
    ]);
  });

  it("draws a person's message as plain text when no piece is passed for it", () => {
    render(<ConversationTimeline task={conversation} pieces={pieces} />);

    expect(screen.getByText("Chart last quarter's sales")).toBeTruthy();
  });

  it("hands a person's message to its piece, saying whether a turn is under way", () => {
    const seen: [string, boolean][] = [];
    const userMessage = (message: TimelineMessage, busy: boolean) => {
      seen.push([message.id, busy]);
      return <p>{message.text}</p>;
    };

    render(
      <ConversationTimeline
        task={{ ...conversation, phase: { kind: "working", steps: [] } }}
        pieces={{ ...pieces, userMessage }}
      />,
    );

    expect(seen).toEqual([["m1", true]]);
  });

  it("draws a delegated specialist's run through its own piece, in sequence order", () => {
    const task: TimelineTask<Entry, Entry, Entry, Entry> = {
      ...conversation,
      specialistRuns: [{ id: "s1", sequence: 1.5 }],
    };
    const { container } = render(
      <ConversationTimeline
        task={task}
        pieces={{
          ...pieces,
          specialistRun: (run: Entry) => (
            <p data-piece="">{`specialistRun ${run.id}`}</p>
          ),
        }}
      />,
    );

    expect(
      [...container.querySelectorAll("[data-piece]")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["actions a1", "specialistRun s1", "actions a2", "view v1"]);
  });

  it("says where a condensing failed, and why, in plain words", () => {
    const { container } = render(
      <ConversationTimeline
        task={{
          ...conversation,
          condensings: [
            {
              id: "c1",
              sequence: 1.5,
              createdAt: "2026-09-24T10:00:00.000Z",
              targetTokens: 13_600,
              tokensBefore: 14_200,
              outcome: "failed",
              reason: "request-failed",
              detail: "The provider is overloaded.",
            },
          ],
        }}
        pieces={pieces}
      />,
    );

    const notice = screen.getByText(
      "Zhiyin could not compact the earlier conversation. It will try again later.",
    );
    expect(notice).toBeVisible();
    expect(
      screen.getByText(
        "Why: the request to the model failed (The provider is overloaded.).",
      ),
    ).toBeVisible();
    const [first, second] = [...container.querySelectorAll("[data-piece]")];
    expect(
      first!.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      second!.compareDocumentPosition(notice) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it.each([
    ["too-large", /larger than the model can read at once/],
    ["unusable", /answer was not a usable summary/],
  ] as const)("says what a %s failure means", (reason, words) => {
    render(
      <ConversationTimeline
        task={{
          ...conversation,
          condensings: [
            {
              id: "c1",
              sequence: 1.5,
              createdAt: "2026-09-24T10:00:00.000Z",
              targetTokens: 13_600,
              tokensBefore: 14_200,
              outcome: "failed",
              reason,
            },
          ],
        }}
        pieces={pieces}
      />,
    );

    expect(screen.getByText(words)).toBeVisible();
  });

  it("says there is nothing old enough to compact only until the next message", () => {
    const notice = {
      id: "c1",
      sequence: 5,
      createdAt: "2026-09-24T10:00:00.000Z",
      targetTokens: 13_600,
      tokensBefore: 2_000,
      outcome: "failed" as const,
      reason: "nothing-to-condense" as const,
    };
    const { rerender } = render(
      <ConversationTimeline
        task={{ ...conversation, condensings: [notice] }}
        pieces={pieces}
      />,
    );
    expect(
      screen.getByText(/no older messages to summarise yet/),
    ).toBeVisible();

    rerender(
      <ConversationTimeline
        task={{
          ...conversation,
          messages: [
            ...conversation.messages,
            { id: "m3", role: "user", text: "Next", sequence: 5 },
          ],
          condensings: [notice],
        }}
        pieces={pieces}
      />,
    );
    expect(screen.queryByText(/no older messages to summarise yet/)).toBeNull();
  });

  it("dims what was condensed, up to the last message it covered, and says why", () => {
    render(
      <ConversationTimeline
        task={{
          ...conversation,
          messages: [
            ...conversation.messages,
            { id: "m3", role: "user", text: "Now the table", sequence: 5 },
          ],
          condensedThrough: "m2",
        }}
        pieces={pieces}
      />,
    );

    const condensed = screen.getByRole("group", {
      name: "Compacted earlier conversation",
    });
    expect(condensed).toHaveAccessibleDescription(
      "Not in the assistant's memory any more: it works from the summary below.",
    );
    expect(condensed).toHaveAttribute("tabindex", "0");
    expect(
      within(condensed).getByText("Chart last quarter's sales"),
    ).toBeVisible();
    expect(within(condensed).getByText("actions a1 a2")).toBeVisible();
    expect(within(condensed).getByText("Here is the chart.")).toBeVisible();
    expect(within(condensed).queryByText("Now the table")).toBeNull();
    expect(screen.getByText("Now the table")).toBeVisible();
  });

  it("draws a compaction before a message that shares its place", () => {
    render(
      <ConversationTimeline
        task={{
          ...conversation,
          messages: [
            ...conversation.messages,
            {
              id: "m3",
              role: "user",
              text: "Remember everything?",
              sequence: 5,
            },
          ],
          condensedThrough: "m2",
          condensings: [
            {
              id: "c1",
              sequence: 5,
              createdAt: "2026-10-07T10:00:00.000Z",
              targetTokens: 13_600,
              tokensBefore: 14_200,
              outcome: "condensed",
              revision: 1,
              throughMessageId: "m2",
              tokensAfter: 2_000,
              messages: 2,
              actions: 2,
              summary: "Sales were charted.",
            },
          ],
        }}
        pieces={pieces}
      />,
    );

    const notice = screen.getByText(
      "Zhiyin compacted the earlier conversation to make room",
    );
    const kept = screen.getByText("Remember everything?");
    expect(
      notice.compareDocumentPosition(kept) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says the earlier conversation is being compacted, in place of Working", () => {
    const { rerender } = render(
      <ConversationTimeline
        task={{ ...conversation, compacting: true }}
        pieces={pieces}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Compacting the earlier conversation",
    );

    rerender(
      <ConversationTimeline
        task={{
          ...conversation,
          messages: [
            ...conversation.messages,
            {
              id: "m3",
              role: "user",
              text: "Remember everything?",
              sequence: 5,
            },
          ],
          phase: { kind: "working", steps: [] },
          compacting: true,
        }}
        pieces={pieces}
      />,
    );
    expect(
      screen.getByText("Compacting the earlier conversation"),
    ).toBeVisible();
    expect(screen.queryByText("Working")).toBeNull();

    rerender(<ConversationTimeline task={conversation} pieces={pieces} />);
    expect(
      screen.queryByText("Compacting the earlier conversation"),
    ).toBeNull();
  });

  it("dims nothing when nothing is condensed, as after a rewind that cut through it", () => {
    render(<ConversationTimeline task={conversation} pieces={pieces} />);

    expect(screen.queryByRole("group")).toBeNull();
  });

  it("draws nothing for a specialist run when no piece is passed for it", () => {
    const task: TimelineTask<Entry, Entry, Entry, Entry> = {
      ...conversation,
      specialistRuns: [{ id: "s1", sequence: 1.5 }],
    };

    expect(() =>
      render(<ConversationTimeline task={task} pieces={pieces} />),
    ).not.toThrow();
  });
});
