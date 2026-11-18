/** The pieces a conversation is made of, each drawn on its own. */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanStatus, TaskPlanItem } from "@zhiyin/contract";
import { PlanPill } from "./PlanPill.js";
import { WorkTrace } from "./WorkTrace.js";
import { MarkdownMessage } from "./MarkdownMessage.js";
import { NewConversation } from "./NewConversation.js";
import { ConversationSkeleton } from "./ConversationSkeleton.js";

const step = (
  id: string,
  title: string,
  status: PlanStatus = "pending",
): TaskPlanItem => ({ id, title, status });

describe("PlanPill", () => {
  it("shows nothing without a plan", () => {
    const { container } = render(<PlanPill items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names the step being worked on and how many are done", () => {
    render(
      <PlanPill
        items={[
          step("1", "Read the spreadsheet", "done"),
          step("2", "Find the totals", "done"),
          step("3", "Write the report", "in_progress"),
          step("4", "Send the summary"),
        ]}
      />,
    );

    const pill = screen.getByRole("button", { name: /plan/i });
    expect(pill).toHaveTextContent("2/4");
    expect(pill).toHaveTextContent("Write the report");
  });

  it("names the next step when none has been started", () => {
    render(
      <PlanPill
        items={[
          step("1", "Read the spreadsheet", "done"),
          step("2", "Find the totals"),
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: /plan/i })).toHaveTextContent(
      "Find the totals",
    );
  });

  it("lists every step in order when opened, and closes on Escape", () => {
    render(
      <PlanPill
        items={[
          step("1", "Read the spreadsheet", "done"),
          step("2", "Write the report", "in_progress"),
          step("3", "Send the summary"),
        ]}
      />,
    );
    const pill = screen.getByRole("button", { name: /plan/i });

    expect(screen.queryByRole("list")).toBeNull();
    fireEvent.click(pill);
    expect(pill).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("Read the spreadsheet"),
      expect.stringContaining("Write the report"),
      expect.stringContaining("Send the summary"),
    ]);

    fireEvent.keyDown(pill, { key: "Escape" });
    expect(screen.queryByRole("list")).toBeNull();
    expect(pill).toHaveFocus();
  });

  it("says done, in progress, to do and skipped in plain words", () => {
    render(
      <PlanPill
        items={[
          step("1", "Read the spreadsheet", "done"),
          step("2", "Write the report", "in_progress"),
          step("3", "Send the summary"),
          step("4", "Check the formatting", "skipped"),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /plan/i }));

    const [done, doing, todo, skipped] = screen.getAllByRole("listitem");
    expect(done).toHaveTextContent("Done");
    expect(doing).toHaveTextContent("In progress");
    expect(todo).toHaveTextContent("To do");
    expect(skipped).toHaveTextContent("Skipped");
  });

  it("says the plan is complete when every step is done or skipped", () => {
    render(
      <PlanPill
        items={[
          step("1", "Read the spreadsheet", "done"),
          step("2", "Check the formatting", "skipped"),
        ]}
      />,
    );

    const pill = screen.getByRole("button", { name: /plan/i });
    expect(pill).toHaveTextContent("Plan complete");
    expect(pill).toHaveTextContent("2/2");
  });

  it("stays open, in the same order, while steps change", () => {
    const { rerender } = render(
      <PlanPill
        items={[
          step("1", "Read the spreadsheet", "in_progress"),
          step("2", "Write the report"),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /plan/i }));

    rerender(
      <PlanPill
        items={[
          step("1", "Read the spreadsheet", "done"),
          step("2", "Write the report", "in_progress"),
        ]}
      />,
    );

    const listed = screen.getAllByRole("listitem");
    expect(listed[0]).toHaveTextContent("Read the spreadsheet");
    expect(listed[0]).toHaveTextContent("Done");
    expect(listed[1]).toHaveTextContent("Write the report");
    expect(listed[1]).toHaveTextContent("In progress");
  });
});

describe("WorkTrace", () => {
  it("writes out hidden characters in a step and what it says", () => {
    render(
      <WorkTrace
        steps={[
          {
            id: "one",
            label: "Inspect ‮the project",
            detail: "Read ‮notes.md",
            status: "active",
          },
        ]}
      />,
    );

    const trace = screen.getByRole("region", { name: "Work trace" });
    expect(trace).toHaveTextContent("Inspect [U+202E]the project");
    expect(trace).toHaveTextContent("Read [U+202E]notes.md");
    expect(trace.outerHTML).not.toContain("‮");
  });

  it("presents the work as one readable sequence", () => {
    render(
      <WorkTrace
        steps={[
          { id: "one", label: "Inspect the project", status: "complete" },
          { id: "two", label: "Draft the release notes", status: "active" },
          { id: "three", label: "Publish after review", status: "queued" },
        ]}
      />,
    );

    const trace = screen.getByRole("region", { name: "Work trace" });
    expect(within(trace).getAllByRole("listitem")).toHaveLength(3);
    expect(within(trace).getByText("Draft the release notes")).toHaveAttribute(
      "aria-current",
      "step",
    );
  });
});

/**
 * Placeholder shapes alone say nothing about what is happening. Shown quickly,
 * they need no words; a wait long enough to notice gets one quiet line.
 */
describe("ConversationSkeleton", () => {
  it("says what it is opening once the wait is long enough to notice", () => {
    vi.useFakeTimers();
    try {
      render(<ConversationSkeleton note="Opening this conversation…" />);
      expect(screen.queryByText("Opening this conversation…")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(2_000);
      });

      expect(screen.getByText("Opening this conversation…")).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("MarkdownMessage", () => {
  it("leaves a diagram written in ordinary prose as text", () => {
    render(
      <MarkdownMessage>
        {[
          "Here is the flow:",
          "",
          "```mermaid",
          "flowchart LR",
          "Draft --> Review",
          "```",
        ].join("\n")}
      </MarkdownMessage>,
    );

    expect(screen.getByText(/flowchart LR/)).toBeVisible();
    expect(document.querySelector("svg")).toBeNull();
  });
});

describe("NewConversation", () => {
  it("offers what the plugins that are on can start, by plugin, one each and four at most", () => {
    const onSuggestion = vi.fn();
    render(
      <NewConversation
        onSuggestion={onSuggestion}
        starters={[
          { plugin: "Engineering", prompt: "Review this project." },
          { plugin: "Research", prompt: "Research this question." },
          { plugin: "Data science", prompt: "Explore this dataset." },
          { plugin: "3D", prompt: "Design a bracket." },
          { plugin: "Publishing", prompt: "Typeset these notes." },
        ]}
      />,
    );

    const ways = screen.getByRole("list", { name: "Ways to begin" });
    expect(
      within(ways)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      "EngineeringReview this project.",
      "ResearchResearch this question.",
      "Data scienceExplore this dataset.",
      "3DDesign a bracket.",
    ]);
    fireEvent.click(within(ways).getByRole("button", { name: /Research/ }));
    expect(onSuggestion).toHaveBeenCalledWith("Research this question.");
  });

  it("shows how to connect a model in place of the ways to begin, when it is handed one", () => {
    render(
      <NewConversation
        onSuggestion={() => undefined}
        setup={<form aria-label="Connect an AI model" />}
      />,
    );

    expect(
      screen.getByRole("form", { name: "Connect an AI model" }),
    ).toBeVisible();
    expect(screen.queryByRole("list", { name: "Ways to begin" })).toBeNull();
  });

  it("offers ways to begin, and none while a conversation cannot be started", () => {
    const onSuggestion = vi.fn();
    const { rerender } = render(
      <NewConversation onSuggestion={onSuggestion} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Make a plan with me" }),
    );
    expect(onSuggestion).toHaveBeenCalledWith("Make a plan with me");

    rerender(<NewConversation onSuggestion={onSuggestion} disabled />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
