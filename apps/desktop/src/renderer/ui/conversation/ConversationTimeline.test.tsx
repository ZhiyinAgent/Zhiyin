import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

  describe("the time beside Working", () => {
    const working = (id: string, turnStartedAt?: string) => ({
      ...conversation,
      id,
      messages: [conversation.messages[0]!],
      actions: [],
      views: [],
      phase: { kind: "working" as const, steps: [] },
      ...(turnStartedAt ? { turnStartedAt } : {}),
    });
    const at = (time: string) => vi.setSystemTime(new Date(time));

    it("shows once the turn has run five seconds, counted from its start, and keeps counting when the conversation is shown again", () => {
      vi.useFakeTimers();
      try {
        at("2026-10-19T09:00:00.000Z");
        const timed = working("timed", "2026-10-19T09:00:00.000Z");
        const shown = render(
          <ConversationTimeline task={timed} pieces={pieces} />,
        );
        expect(screen.getByRole("status")).toHaveTextContent(/^Working$/);
        act(() => vi.advanceTimersByTime(6_000));
        expect(screen.getByRole("status")).toHaveTextContent("Working6 s");

        shown.unmount();
        act(() => vi.advanceTimersByTime(66_000));
        render(<ConversationTimeline task={timed} pieces={pieces} />);
        expect(screen.getByRole("status")).toHaveTextContent(
          "Working1 min 12 s",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("is the shown conversation's own, not the one shown before it", () => {
      vi.useFakeTimers();
      try {
        at("2026-10-19T09:03:00.000Z");
        const shown = render(
          <ConversationTimeline
            task={working("first", "2026-10-19T09:00:00.000Z")}
            pieces={pieces}
          />,
        );
        expect(screen.getByRole("status")).toHaveTextContent("Working3 min");

        shown.rerender(
          <ConversationTimeline
            task={working("second", "2026-10-19T09:03:00.000Z")}
            pieces={pieces}
          />,
        );
        act(() => vi.advanceTimersByTime(1_000));
        expect(screen.getByRole("status")).toHaveTextContent(/^Working$/);
      } finally {
        vi.useRealTimers();
      }
    });

    it("counts a later turn from its own start", () => {
      vi.useFakeTimers();
      try {
        at("2026-10-19T09:03:00.000Z");
        const shown = render(
          <ConversationTimeline
            task={working("again", "2026-10-19T09:00:00.000Z")}
            pieces={pieces}
          />,
        );
        expect(screen.getByRole("status")).toHaveTextContent("Working3 min");

        shown.rerender(
          <ConversationTimeline task={conversation} pieces={pieces} />,
        );
        shown.rerender(
          <ConversationTimeline
            task={working("again", "2026-10-19T09:03:00.000Z")}
            pieces={pieces}
          />,
        );
        act(() => vi.advanceTimersByTime(1_000));
        expect(screen.getByRole("status")).toHaveTextContent(/^Working$/);
      } finally {
        vi.useRealTimers();
      }
    });

    it("counts from when it is shown, for each conversation, where the turn's start is not known", () => {
      vi.useFakeTimers();
      try {
        at("2026-10-19T09:00:00.000Z");
        const shown = render(
          <ConversationTimeline task={working("first")} pieces={pieces} />,
        );
        act(() => vi.advanceTimersByTime(180_000));
        expect(screen.getByRole("status")).toHaveTextContent("Working3 min");

        shown.rerender(
          <ConversationTimeline task={working("second")} pieces={pieces} />,
        );
        act(() => vi.advanceTimersByTime(1_000));
        expect(screen.getByRole("status")).toHaveTextContent(/^Working$/);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  /**
   * A model that sends its reasoning is read while it reasons: what it is
   * thinking now sits under the status, so minutes of it are not minutes of
   * nothing. Reasoning that is over stays out of the conversation.
   */
  it("shows what the model is reasoning now under the status, and none of what it reasoned before", () => {
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
    expect(screen.getByRole("group", { name: "Reasoning" })).toHaveTextContent(
      "Check another source.",
    );
    expect(
      container.querySelectorAll("[aria-label='Zhiyin response']"),
    ).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Working");
    expect(screen.getByText("actions a1")).toBeVisible();
  });

  it("draws the end of a long trace, not the whole of it", () => {
    const early = "The first idea, long since left behind.";
    const latest = "So the cable leaves from the back.";
    render(
      <ConversationTimeline
        task={{
          ...conversation,
          messages: [
            conversation.messages[0]!,
            {
              id: "thinking",
              role: "assistant",
              text: "",
              sequence: 1,
              reasoning: {
                text: `${early}\n${"Or perhaps the other way round. ".repeat(600)}\n${latest}`,
                status: "streaming",
              },
            },
          ],
          actions: [],
          views: [],
          plan: [],
          phase: { kind: "working", steps: [], note: "Thinking" },
        }}
        pieces={pieces}
      />,
    );

    const trace = screen.getByRole("group", { name: "Reasoning" });
    expect(trace).toHaveTextContent(latest);
    expect(trace).not.toHaveTextContent(early);
    expect(trace.textContent?.length).toBeLessThan(5_000);
    expect(trace.textContent?.startsWith("…")).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("Thinking");
  });

  it("takes the trace away once the answer has begun", () => {
    render(
      <ConversationTimeline
        task={{
          ...conversation,
          messages: [
            conversation.messages[0]!,
            {
              id: "answering",
              role: "assistant",
              text: "The cable leaves from the back.",
              sequence: 1,
              reasoning: { text: "Weighing both sides.", status: "complete" },
            },
          ],
          actions: [],
          views: [],
          plan: [],
          phase: { kind: "working", steps: [] },
        }}
        pieces={pieces}
      />,
    );

    expect(screen.queryByRole("group", { name: "Reasoning" })).toBeNull();
    expect(screen.queryByText("Weighing both sides.")).toBeNull();
  });

  /**
   * While the model only reasons, the person can ask for the answer now. The
   * offer stands beside the status for as long as the reasoning shows, takes
   * one press, and stands again when there was nothing left to stop.
   */
  it("offers the answer now while the model only reasons, and takes one press", async () => {
    let settle!: (stopped: boolean) => void;
    const answerNow = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
    );
    render(
      <ConversationTimeline
        task={{
          ...conversation,
          messages: [
            conversation.messages[0]!,
            {
              id: "thinking",
              role: "assistant",
              text: "",
              sequence: 1,
              reasoning: { text: "Weighing both sides.", status: "streaming" },
            },
          ],
          actions: [],
          views: [],
          phase: { kind: "working", steps: [], note: "Thinking" },
        }}
        pieces={{ ...pieces, answerNow }}
      />,
    );
    const offer = screen.getByRole("button", { name: "Answer now" });
    // Beside the status, in the same response.
    expect(
      within(
        screen.getByRole("status").closest("article") as HTMLElement,
      ).getByRole("button", { name: "Answer now" }),
    ).toBe(offer);

    fireEvent.click(offer);
    fireEvent.click(offer);

    expect(answerNow).toHaveBeenCalledTimes(1);
    expect(offer).toBeDisabled();
    // The answer had begun, so nothing was stopped: the offer stands again.
    await act(async () => settle(false));
    expect(screen.getByRole("button", { name: "Answer now" })).toBeEnabled();
  });

  it("offers no answer now once the answer has begun, when the turn is over, or where it cannot be asked for", () => {
    const reasoning = {
      id: "thinking",
      role: "assistant" as const,
      text: "",
      sequence: 1,
      reasoning: { text: "Weighing both sides.", status: "streaming" as const },
    };
    const working = { kind: "working" as const, steps: [], note: "Thinking" };
    const drawn = (
      task: Partial<TimelineTask<Entry, Entry, Entry>>,
      answerNow?: () => Promise<boolean>,
    ) => {
      const shown = render(
        <ConversationTimeline
          task={{ ...conversation, actions: [], views: [], ...task }}
          pieces={{ ...pieces, ...(answerNow ? { answerNow } : {}) }}
        />,
      );
      const offered = screen.queryByRole("button", { name: "Answer now" });
      shown.unmount();
      return offered;
    };
    const asked = async () => true;

    expect(
      drawn(
        { messages: [conversation.messages[0]!, reasoning], phase: working },
        asked,
      ),
    ).not.toBeNull();
    expect(
      drawn({
        messages: [conversation.messages[0]!, reasoning],
        phase: working,
      }),
    ).toBeNull();
    expect(
      drawn(
        {
          messages: [
            conversation.messages[0]!,
            { ...reasoning, text: "It comes to" },
          ],
          phase: { kind: "working", steps: [] },
        },
        asked,
      ),
    ).toBeNull();
    expect(
      drawn(
        {
          messages: [conversation.messages[0]!, reasoning],
          phase: { kind: "interrupted" },
        },
        asked,
      ),
    ).toBeNull();
  });

  /**
   * A message added while a turn works is in the conversation at once, at
   * its end, said to be waiting: the person sees it was taken. Under it they
   * can take it back, and, while the model only reasons, have it sent now.
   */
  describe("a message that waits for the turn's next step", () => {
    const reasoning = {
      id: "thinking",
      role: "assistant" as const,
      text: "",
      sequence: 1,
      reasoning: { text: "Weighing both sides.", status: "streaming" as const },
    };
    const waitingTask = (
      over: Partial<TimelineTask<Entry, Entry, Entry>> = {},
    ): TimelineTask<Entry, Entry, Entry> => ({
      ...conversation,
      messages: [conversation.messages[0]!, reasoning],
      actions: [],
      views: [],
      phase: { kind: "working", steps: [], note: "Thinking" },
      guidance: [
        { id: "g1", text: "Use the 2024 figures", status: "pending" },
        { id: "g2", text: "And keep it to one page", status: "pending" },
      ],
      ...over,
    });
    const waitingMessages = () =>
      screen.queryAllByRole("group", { name: "Message waiting to be read" });

    it("is drawn after everything else, as the person wrote it, and says it will be read at the next step", () => {
      const { container } = render(
        <ConversationTimeline task={waitingTask()} pieces={pieces} />,
      );

      const [first, second] = waitingMessages();
      expect(first).toHaveTextContent("Use the 2024 figures");
      expect(first).toHaveTextContent("Read at the next step");
      expect(second).toHaveTextContent("And keep it to one page");
      // Below what the model is doing now: it was said after that began.
      const status = screen.getAllByRole("status")[0] as HTMLElement;
      expect(
        status.compareDocumentPosition(first as HTMLElement) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(container.lastElementChild).toBe(second);
    });

    it("is not drawn once it has come back as a draft, or when nothing waits", () => {
      render(
        <ConversationTimeline
          task={waitingTask({
            guidance: [
              { id: "g1", text: "Use the 2024 figures", status: "draft" },
            ],
          })}
          pieces={pieces}
        />,
      );

      expect(waitingMessages()).toHaveLength(0);
      expect(screen.queryByText("Use the 2024 figures")).toBeNull();
    });

    it("can be taken back, each on its own", async () => {
      const takeBack = vi.fn(async () => {});
      render(
        <ConversationTimeline
          task={waitingTask()}
          pieces={{ ...pieces, waitingMessage: { takeBack } }}
        />,
      );

      fireEvent.click(
        within(waitingMessages()[1] as HTMLElement).getByRole("button", {
          name: "Take back",
        }),
      );

      expect(takeBack).toHaveBeenCalledExactlyOnceWith("g2");
      await act(async () => {});
    });

    it("can be sent now while the model only reasons, from under the last one, in one press", async () => {
      let settle!: (stopped: boolean) => void;
      const sendNow = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            settle = resolve;
          }),
      );
      render(
        <ConversationTimeline
          task={waitingTask()}
          pieces={{
            ...pieces,
            waitingMessage: { takeBack: async () => {}, sendNow },
          }}
        />,
      );
      const [first, last] = waitingMessages() as HTMLElement[];
      expect(
        within(first as HTMLElement).queryByRole("button", {
          name: "Send now",
        }),
      ).toBeNull();
      const offer = within(last as HTMLElement).getByRole("button", {
        name: "Send now",
      });

      fireEvent.click(offer);
      fireEvent.click(offer);

      expect(sendNow).toHaveBeenCalledTimes(1);
      expect(offer).toBeDisabled();
      // The model was past reasoning: nothing was stopped, and it waits on.
      await act(async () => settle(false));
      expect(offer).toBeEnabled();
    });

    it("is not offered to be sent now while the model works on something else", () => {
      render(
        <ConversationTimeline
          task={waitingTask({
            messages: [conversation.messages[0]!],
            phase: { kind: "working", steps: [], note: "Composing a request" },
          })}
          pieces={{
            ...pieces,
            waitingMessage: {
              takeBack: async () => {},
              sendNow: async () => true,
            },
          }}
        />,
      );

      expect(screen.queryByRole("button", { name: "Send now" })).toBeNull();
      expect(screen.getAllByRole("button", { name: "Take back" })).toHaveLength(
        2,
      );
    });
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

  /**
   * A model can reason for minutes before its first words. What the turn is
   * doing is then said the way "Working" is, with the time beside it, in a
   * conversation's first round as in any later one.
   */
  it("says a turn is thinking as its status, in the first round and after", () => {
    const thinking: TimelineTask<Entry, Entry, Entry>["phase"] = {
      kind: "working",
      steps: [],
      note: "Thinking",
    };
    const first = render(
      <ConversationTimeline
        task={{
          ...conversation,
          messages: [conversation.messages[0]!],
          actions: [],
          views: [],
          plan: [],
          phase: thinking,
        }}
        pieces={pieces}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Thinking");
    first.unmount();

    render(
      <ConversationTimeline
        task={{ ...conversation, plan: [], phase: thinking }}
        pieces={pieces}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Thinking");
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
    const { container } = render(
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

    const condensed = screen.getAllByRole("group", {
      name: "Compacted earlier conversation",
    });
    for (const entry of condensed)
      expect(entry).toHaveAccessibleDescription(
        "Not in the assistant's memory any more: it works from the summary below.",
      );
    expect(condensed.map((entry) => entry.textContent)).toEqual([
      // What condensed means is said once, before the first of them.
      "Not in the assistant's memory any more: it works from the summary below.Chart last quarter's sales",
      "actions a1 a2",
      "view v1",
      expect.stringContaining("Here is the chart."),
    ]);
    expect(screen.getByText("Now the table")).toBeVisible();
    expect(
      screen.getByText("Now the table").closest("[aria-describedby]"),
    ).toBeNull();
    // The explanation can be reached from the keyboard, once.
    const note = within(container).getByText(
      "Not in the assistant's memory any more: it works from the summary below.",
    );
    expect(note).toHaveAttribute("tabindex", "0");
  });

  /**
   * Compacting changes how earlier entries look, not what they are: each stays
   * the element it was, with its pictures already read and its place kept.
   */
  it("keeps every entry it dims as the element it was", async () => {
    const readPicture = vi.fn(async () => ({
      status: "ready" as const,
      mediaType: "image/png",
      data: "iVBORw==",
    }));
    const pictured = {
      ...conversation,
      messages: [
        {
          ...conversation.messages[0]!,
          attachments: [
            {
              kind: "picture" as const,
              id: "picture-1",
              name: "sales.png",
              mediaType: "image/png",
              bytes: 4,
              source: "pasted-pictures/c/picture-1",
            },
          ],
        },
        conversation.messages[1]!,
        { id: "m3", role: "user" as const, text: "Now the table", sequence: 5 },
      ],
    };
    const shown = render(
      <ConversationTimeline
        task={pictured}
        pieces={{ ...pieces, readPicture }}
      />,
    );
    await screen.findByRole("button", { name: "Open picture sales.png" });
    const answer = screen.getByText("Here is the chart.");
    const later = screen.getByText("Now the table");
    const reads = readPicture.mock.calls.length;

    shown.rerender(
      <ConversationTimeline
        task={{ ...pictured, condensedThrough: "m2" }}
        pieces={{ ...pieces, readPicture }}
      />,
    );

    expect(screen.getByText("Here is the chart.")).toBe(answer);
    expect(screen.getByText("Now the table")).toBe(later);
    expect(readPicture).toHaveBeenCalledTimes(reads);
    expect(answer.closest('[role="group"]')).toHaveAccessibleName(
      "Compacted earlier conversation",
    );
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

  it("counts the compacting from when it began, and keeps counting when the conversation is shown again", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-19T09:02:00.000Z"));
      const compacting = {
        ...conversation,
        compacting: true,
        compactingSince: "2026-10-19T09:00:00.000Z",
      };
      const shown = render(
        <ConversationTimeline task={compacting} pieces={pieces} />,
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        "Compacting the earlier conversation2 min",
      );

      shown.unmount();
      act(() => vi.advanceTimersByTime(60_000));
      render(<ConversationTimeline task={compacting} pieces={pieces} />);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Compacting the earlier conversation3 min",
      );
    } finally {
      vi.useRealTimers();
    }
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

    const drawn = (shown: typeof task) => {
      const { container, unmount } = render(
        <ConversationTimeline task={shown} pieces={pieces} />,
      );
      const seen = {
        responses: container.querySelectorAll("[aria-label='Zhiyin response']")
          .length,
        pieces: [...container.querySelectorAll("[data-piece]")].map(
          (piece) => piece.textContent,
        ),
      };
      unmount();
      return seen;
    };

    const withRun = drawn(task);

    // No response is drawn for it, and nothing but the other entries' pieces.
    expect(withRun.responses).toBe(drawn(conversation).responses);
    for (const piece of withRun.pieces)
      expect(piece).toMatch(/^(actions|view) /);
  });
});
