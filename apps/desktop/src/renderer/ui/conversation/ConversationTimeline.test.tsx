import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ConversationTimeline,
  type TimelineMessage,
  type TimelineTask,
} from "./ConversationTimeline.js";

type Entry = { id: string; sequence?: number };

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
   * The other half of the freeze that was reported: the loop now says it is
   * composing a call while the model writes one, and that sentence is only
   * worth sending if it arrives on screen. A note with no actions and no plan
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
   * The case the first one missed.
   *
   * A turn that has already done something has actions, and the note used to be
   * drawn only when there were none — so in any real session past its first
   * round it was sent and never seen. Measured in the installed application on
   * 2026-09-14 before this was fixed: eight views drawn, no note shown once.
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
