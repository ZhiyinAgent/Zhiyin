/** The pieces a conversation is made of, each drawn on its own. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskPlan } from "./TaskPlan.js";
import { WorkTrace } from "./WorkTrace.js";
import { ContextShelf } from "./ContextShelf.js";
import { Composer } from "./Composer.js";
import { OutcomeCard } from "./OutcomeCard.js";
import { MarkdownMessage } from "./MarkdownMessage.js";

describe("TaskPlan", () => {
  it("shows criteria and live reviewer states without claiming unfinished work", () => {
    render(
      <TaskPlan
        items={[
          {
            id: "plan-1",
            title: "Identify the project",
            criterion:
              "The project identity is supported by workspace evidence.",
            status: "verified",
            verification: "package.json names the project.",
          },
          {
            id: "plan-2",
            title: "Explain the architecture",
            criterion: "The answer names the runtime and package boundaries.",
            status: "checking",
          },
          {
            id: "plan-3",
            title: "Summarize the current state",
            criterion: "The answer distinguishes working and unfinished areas.",
            status: "pending",
          },
        ]}
      />,
    );

    const plan = screen.getByRole("region", { name: "Task plan" });
    expect(within(plan).getAllByRole("listitem")).toHaveLength(3);
    expect(within(plan).getByText("Checking")).toBeVisible();
    expect(
      within(plan).getByText(
        "The answer distinguishes working and unfinished areas.",
      ),
    ).toBeVisible();
    expect(
      within(plan).getByText("package.json names the project."),
    ).toBeVisible();
  });
});

describe("WorkTrace", () => {
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

describe("ContextShelf", () => {
  it("shows tangible workspace context without repeating the work plan", () => {
    render(
      <ContextShelf
        context={{
          kind: "workspace",
          project: "Zhiyin Desktop",
          files: [
            { name: "release-notes.md", meta: "Edited · 2 min ago" },
            { name: "changelog.md", meta: "Read" },
          ],
          changes: "+42  −8",
        }}
      />,
    );

    const shelf = screen.getByRole("complementary", {
      name: "Session context",
    });
    expect(within(shelf).getByText("release-notes.md")).toBeInTheDocument();
    expect(within(shelf).queryByText(/draft the release notes/i)).toBeNull();
  });

  it("shows only supplied browser context and no unconnected action", () => {
    render(
      <ContextShelf
        context={{
          kind: "browser",
          title: "Zhiyin documentation",
          url: "docs.zhiyin.app/releases/new",
        }}
      />,
    );

    expect(
      screen.getByText("docs.zhiyin.app/releases/new"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Publish what changed, clearly.")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Take control of browser" }),
    ).toBeNull();
  });
});

describe("Composer", () => {
  it("submits non-empty messages and clears the draft", () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);

    const input = screen.getByLabelText("Message Zhiyin");
    fireEvent.change(input, {
      target: { value: "Focus on the security notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith("Focus on the security notes");
    expect(input).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Add context" })).toBeNull();
  });

  it("explains when input is paused for a decision", () => {
    render(
      <Composer
        disabledReason="Answer the permission request first"
        disabledPlaceholder="Waiting for your decision"
      />,
    );

    expect(screen.getByLabelText("Message Zhiyin")).toBeDisabled();
    expect(screen.getByLabelText("Message Zhiyin")).toHaveAttribute(
      "placeholder",
      "Waiting for your decision",
    );
    expect(
      screen.getByText("Answer the permission request first"),
    ).toBeInTheDocument();
  });

  it("replaces Send with Stop while a response is running", () => {
    const onStop = vi.fn();
    render(<Composer running onStop={onStop} />);

    expect(screen.getByLabelText("Message Zhiyin")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop task" }));
    expect(onStop).toHaveBeenCalledOnce();
  });
});

describe("OutcomeCard", () => {
  it("exposes the completed artifact as the primary next action", () => {
    const onOpen = vi.fn();
    render(
      <OutcomeCard
        title="Release notes are ready"
        file="release-notes.md"
        summary="12 commits distilled into a concise public draft."
        onOpen={onOpen}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open release-notes.md" }),
    );
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("does not present an artifact as clickable without an open action", () => {
    render(
      <OutcomeCard
        title="Release notes are ready"
        file="release-notes.md"
        summary="12 commits distilled into a concise public draft."
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Open release-notes.md" }),
    ).toBeNull();
    expect(screen.getByText("Created")).toBeVisible();
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
