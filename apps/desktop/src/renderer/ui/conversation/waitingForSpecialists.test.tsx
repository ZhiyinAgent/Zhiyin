import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationTimeline } from "./ConversationTimeline.js";

const now = Date.parse("2026-09-30T12:00:00.000Z");

const finished = {
  id: "task-1",
  messages: [
    {
      id: "user",
      role: "user" as const,
      text: "Check the reports",
      sequence: 0,
    },
    {
      id: "assistant",
      role: "assistant" as const,
      text: "The fact-checker is working on it.",
      sequence: 1,
    },
  ],
  actions: [],
  views: [],
  interactions: [],
  specialistRuns: [],
  condensings: [],
  plan: [],
  phase: {
    kind: "completed" as const,
    outcome: { title: "Done", summary: "Waiting on the fact-checker." },
  },
};

const pieces = {
  actions: () => null,
  view: () => null,
  interaction: () => null,
};

describe("waiting for specialists", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  it("says which specialist it is waiting for, how many calls it has made and for how long", () => {
    render(
      <ConversationTimeline
        task={{
          ...finished,
          waitingOn: {
            names: ["Fact-checker"],
            calls: 4,
            since: new Date(now - 80_000).toISOString(),
          },
        }}
        pieces={pieces}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Waiting for Fact-checker · 4 calls · 1 min 20 s",
    );
  });

  it("names every specialist it is waiting for, and says one call as one", () => {
    render(
      <ConversationTimeline
        task={{
          ...finished,
          waitingOn: {
            names: ["Fact-checker", "Researcher", "Editor"],
            calls: 1,
            since: new Date(now - 5_000).toISOString(),
          },
        }}
        pieces={pieces}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Waiting for Fact-checker, Researcher and Editor · 1 call · 5 s",
    );
  });

  it("shows nothing when no specialist is running", () => {
    render(<ConversationTimeline task={finished} pieces={pieces} />);

    expect(screen.queryByText(/Waiting for/)).not.toBeInTheDocument();
  });
});
