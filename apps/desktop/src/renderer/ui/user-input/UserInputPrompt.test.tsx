import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  PendingUserInputRequest,
  TaskInteraction,
} from "@zhiyin/contract";
import { InteractionCard, UserInputPrompt } from "./UserInputPrompt.js";

const clarification: PendingUserInputRequest = {
  id: "input-1",
  kind: "clarification",
  title: "Choose the release shape",
  questions: [
    {
      id: "audience",
      prompt: "Who should receive it first?",
      options: [
        {
          id: "team",
          label: "Internal team",
          description: "Try it privately first.",
        },
        { id: "customers", label: "Customers" },
      ],
    },
    {
      id: "date",
      prompt: "What date should it use?",
      allowText: true,
    },
  ],
};

const singleClarification: PendingUserInputRequest = {
  id: "input-single",
  kind: "clarification",
  title: "One detail",
  questions: [
    {
      id: "audience",
      prompt: "Who should receive it first?",
      options: [
        { id: "team", label: "Internal team" },
        { id: "customers", label: "Customers" },
      ],
    },
  ],
};

const quiz: PendingUserInputRequest = {
  id: "quiz-1",
  kind: "quiz",
  title: "Release readiness",
  questions: [
    {
      id: "gate",
      prompt: "Which command runs the repository gate?",
      answers: [
        { id: "test", label: "pnpm test" },
        { id: "gate", label: "scripts/gate.ps1" },
      ],
      selection: "single",
      correctAnswerIds: ["gate"],
      explanation: "The gate includes more than the unit suite.",
    },
    {
      id: "evidence",
      prompt: "Which are product evidence?",
      answers: [
        { id: "unit", label: "Unit tests" },
        { id: "review", label: "Independent review" },
        { id: "installed", label: "Installed-app exercise" },
      ],
      selection: "multiple",
      correctAnswerIds: ["review", "installed"],
      explanation:
        "Independent review and an installed-app exercise provide evidence outside the implementation itself.",
    },
  ],
};

const workBudget: PendingUserInputRequest = {
  id: "budget-1",
  kind: "workBudget",
  title: "Continue working?",
  completedRounds: 24,
};

const folderInstructions: PendingUserInputRequest = {
  id: "folder-1",
  kind: "folderInstructions",
  title: "Use this folder's instructions?",
  path: "AGENTS.md",
  text: "Invoices live in /finance.",
  truncated: true,
};

describe("UserInputPrompt", () => {
  it("shows a folder's instructions in full before they are used, and sends the choice", () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <UserInputPrompt
        prompt={folderInstructions}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText("Invoices live in /finance.")).toBeVisible();
    expect(screen.getByText(/AGENTS\.md/)).toBeVisible();
    expect(screen.getByText(/shortened/i)).toBeVisible();
    expect(screen.getByText(/never grant permission/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Use them" }));

    expect(onSubmit).toHaveBeenCalledWith({
      answers: [{ questionId: "folder-instructions", answerIds: ["use"] }],
    });
  });

  it("lets the person ignore a folder's instructions", () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <UserInputPrompt
        prompt={folderInstructions}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ignore them" }));

    expect(onSubmit).toHaveBeenCalledWith({
      answers: [{ questionId: "folder-instructions", answerIds: ["ignore"] }],
    });
  });

  it("offers an explicit continue or pause choice at a work checkpoint", () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <UserInputPrompt
        prompt={workBudget}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    expect(
      screen.getByText("This task has completed 24 tool rounds."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(onSubmit).toHaveBeenCalledWith({
      answers: [{ questionId: "work-budget", answerIds: ["pause"] }],
    });
  });

  it("says why the work may be going nowhere when Zhiyin saw it repeat itself", () => {
    render(
      <UserInputPrompt
        prompt={
          {
            ...workBudget,
            reason:
              "The assistant repeated the same list_directory call 4 times.",
          } as PendingUserInputRequest
        }
        onSubmit={async () => {}}
        onCancel={() => {}}
      />,
    );

    expect(
      screen.getByText(
        "The assistant repeated the same list_directory call 4 times.",
      ),
    ).toBeVisible();
  });

  it("answers several clarifying questions once", async () => {
    let release: (() => void) | undefined;
    const onSubmit = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    render(
      <UserInputPrompt
        prompt={clarification}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText("Question 1 of 2")).toBeVisible();
    expect(screen.getByText("Try it privately first.")).toBeVisible();
    expect(screen.queryByText("What date should it use?")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Next question" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Internal team"));
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));

    expect(screen.getByText("Question 2 of 2")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review answers" }));

    expect(screen.getByText("Internal team")).toBeVisible();
    expect(screen.getByText("2026-10-01")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    fireEvent.click(screen.getByRole("button", { name: "Sending…" }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({
      answers: [
        { questionId: "audience", answerIds: ["team"] },
        { questionId: "date", text: "2026-10-01" },
      ],
    });
    release?.();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send answers" }),
      ).toBeEnabled(),
    );
  });

  it("keeps clarifying answers when moving between questions and back from review", () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <UserInputPrompt
        prompt={clarification}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("Internal team"));
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "2026-10-01" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous question" }));
    expect(screen.getByLabelText("Internal team")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByRole("textbox")).toHaveValue("2026-10-01");

    fireEvent.click(screen.getByRole("button", { name: "Review answers" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Change answer to Who should receive it first?",
      }),
    );
    expect(screen.getByText("Question 1 of 2")).toBeVisible();
    expect(screen.getByLabelText("Internal team")).toBeChecked();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps a selected clarification choice inside its option card", () => {
    render(
      <UserInputPrompt
        prompt={singleClarification}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );

    const input = screen.getByLabelText("Internal team");
    const option = input.closest("label");
    expect(option).not.toBeNull();
    const cardClass = option?.className ?? "";

    fireEvent.click(input);

    expect(option).toHaveClass(cardClass);
    expect(option?.className.trim().split(/\s+/)).toHaveLength(2);
  });

  it("sends a single clarifying question without a review step", () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <UserInputPrompt
        prompt={singleClarification}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    expect(screen.queryByText(/Question 1 of/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Customers"));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

    expect(onSubmit).toHaveBeenCalledWith({
      answers: [{ questionId: "audience", answerIds: ["customers"] }],
    });
  });

  it("stops the task from a clarifying question", () => {
    const onCancel = vi.fn();
    render(
      <UserInputPrompt
        prompt={clarification}
        onSubmit={async () => {}}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop task" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("checks one quiz question at a time and keeps reviewed answers when navigating", () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <UserInputPrompt prompt={quiz} onSubmit={onSubmit} onCancel={() => {}} />,
    );

    expect(screen.getByText("Question 1 of 2")).toBeVisible();
    expect(
      screen.getByText("Which command runs the repository gate?"),
    ).toBeVisible();
    expect(screen.queryByText("Which are product evidence?")).toBeNull();
    expect(screen.getByRole("button", { name: "Check answer" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("pnpm test"));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));

    expect(screen.getByText("Not quite")).toBeVisible();
    expect(
      screen.getByText("The gate includes more than the unit suite."),
    ).toBeVisible();
    expect(screen.queryByText(/Correct answer:/)).toBeNull();
    expect(screen.getByLabelText("pnpm test, incorrect")).toBeDisabled();
    expect(screen.getByLabelText("scripts/gate.ps1, correct")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByText("Question 2 of 2")).toBeVisible();
    expect(screen.getByText("Choose all that apply")).toBeVisible();
    fireEvent.click(screen.getByLabelText("Independent review"));

    fireEvent.click(screen.getByRole("button", { name: "Previous question" }));
    expect(screen.getByLabelText("pnpm test, incorrect")).toBeChecked();
    expect(screen.getByText("Not quite")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByLabelText("Independent review")).toBeChecked();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("marks a correct subset of a multiple-answer question as incomplete", () => {
    render(
      <UserInputPrompt prompt={quiz} onSubmit={() => {}} onCancel={() => {}} />,
    );

    fireEvent.click(screen.getByLabelText("scripts/gate.ps1"));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    fireEvent.click(screen.getByLabelText("Independent review"));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));

    expect(screen.getByText("Incomplete")).toBeVisible();
    expect(screen.getByLabelText("Independent review, correct")).toBeChecked();
    expect(
      screen.getByLabelText("Installed-app exercise, missed"),
    ).not.toBeChecked();
    expect(screen.queryByText("Correct answer")).toBeNull();
  });

  it("shows the final score, resets the attempt, and submits only when finished", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <UserInputPrompt prompt={quiz} onSubmit={onSubmit} onCancel={() => {}} />,
    );

    fireEvent.click(screen.getByLabelText("pnpm test"));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    fireEvent.click(screen.getByLabelText("Independent review"));
    fireEvent.click(screen.getByLabelText("Installed-app exercise"));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    expect(screen.getByText("Correct")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "See result" }));

    expect(screen.getByText("1 / 2")).toBeVisible();
    expect(screen.getByText("Want another go?")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Question 1 of 2")).toBeVisible();
    expect(screen.getByLabelText("pnpm test")).not.toBeChecked();
    expect(screen.queryByText("Not quite")).toBeNull();

    fireEvent.click(screen.getByLabelText("scripts/gate.ps1"));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    fireEvent.click(screen.getByLabelText("Independent review"));
    fireEvent.click(screen.getByLabelText("Installed-app exercise"));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    fireEvent.click(screen.getByRole("button", { name: "See result" }));
    expect(screen.getByText("2 / 2")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Finish quiz" }));

    expect(onSubmit).toHaveBeenCalledWith({
      answers: [
        { questionId: "gate", answerIds: ["gate"] },
        { questionId: "evidence", answerIds: ["review", "installed"] },
      ],
    });
  });

  it("keeps a failed answer editable", async () => {
    render(
      <UserInputPrompt
        prompt={clarification}
        onSubmit={async () => {
          throw new Error("offline");
        }}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Internal team"));
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review answers" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The answer could not be sent",
    );
    expect(screen.getByRole("button", { name: "Send answers" })).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Change answer to Who should receive it first?",
      }),
    );
    expect(screen.getByLabelText("Internal team")).toBeChecked();
  });
});

describe("InteractionCard", () => {
  it("reveals quiz grading only after submission", () => {
    const interaction: TaskInteraction = {
      id: "interaction-quiz-1",
      callId: "quiz-1",
      request: quiz,
      response: {
        answers: [
          { questionId: "gate", answerIds: ["test"] },
          { questionId: "evidence", answerIds: ["review", "installed"] },
        ],
      },
    };
    render(<InteractionCard interaction={interaction} />);

    expect(screen.getByText("1 of 2 correct")).toBeVisible();
    const first = screen.getByRole("group", {
      name: "Which command runs the repository gate?",
    });
    expect(within(first).getByText("Incorrect")).toBeVisible();
    expect(
      within(first).getByText("The gate includes more than the unit suite."),
    ).toBeVisible();
  });

  it("keeps partial multi-answer grading distinct in the saved result", () => {
    const interaction: TaskInteraction = {
      id: "interaction-quiz-2",
      callId: "quiz-1",
      request: quiz,
      response: {
        answers: [
          { questionId: "gate", answerIds: ["gate"] },
          { questionId: "evidence", answerIds: ["review"] },
        ],
      },
    };
    render(<InteractionCard interaction={interaction} />);

    const second = screen.getByRole("group", {
      name: "Which are product evidence?",
    });
    expect(within(second).getByText("Incomplete")).toBeVisible();
    expect(within(second).queryByText("Incorrect")).toBeNull();
  });

  it("bands the saved score by how much of the quiz was right", () => {
    const total = 10;
    const banded = (correct: number) => {
      const request: PendingUserInputRequest = {
        id: "quiz-band",
        kind: "quiz",
        title: "Banding",
        questions: Array.from({ length: total }, (_, index) => ({
          id: `q${index}`,
          prompt: `Question ${index + 1}?`,
          answers: [
            { id: "right", label: "Right" },
            { id: "wrong", label: "Wrong" },
          ],
          selection: "single" as const,
          correctAnswerIds: ["right"],
          explanation: "Because.",
        })),
      };
      const interaction: TaskInteraction = {
        id: `interaction-band-${correct}`,
        callId: "quiz-band",
        request,
        response: {
          answers: request.questions.map((question, index) => ({
            questionId: question.id,
            answerIds: [index < correct ? "right" : "wrong"],
          })),
        },
      };
      const view = render(<InteractionCard interaction={interaction} />);
      const score = screen.getByText(`${correct} of ${total} correct`);
      const band = Array.from(score.classList).find((name) =>
        name.startsWith("interaction-card__score--"),
      );
      view.unmount();
      return band;
    };

    expect(banded(8)).toBe("interaction-card__score--strong");
    expect(banded(5)).toBe("interaction-card__score--fair");
    expect(banded(4)).toBe("interaction-card__score--weak");
    expect(banded(3)).toBe("interaction-card__score--weak");
    expect(banded(2)).toBe("interaction-card__score--poor");
  });
});
