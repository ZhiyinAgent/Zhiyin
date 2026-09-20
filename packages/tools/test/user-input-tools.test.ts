import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";

const clarification = {
  title: "Choose the release shape",
  questions: [
    {
      id: "audience",
      prompt: "Who should receive it first?",
      options: [
        { id: "team", label: "Internal team" },
        { id: "customers", label: "Customers" },
      ],
      allowOther: true,
    },
    {
      id: "date",
      prompt: "What date should it use?",
      allowText: true,
    },
  ],
};

const quiz = {
  title: "Release readiness",
  questions: [
    {
      id: "gate",
      prompt: "Which command runs the fast gate?",
      answers: [
        { id: "test", label: "pnpm test" },
        { id: "gate", label: "scripts/gate.ps1" },
      ],
      selection: "single",
      correctAnswerIds: ["gate"],
      explanation: "The repository gate includes more than the unit suite.",
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
        "Product evidence has to include observation outside the implementation itself.",
    },
  ],
};

describe("user input tools", () => {
  it("advertises clarification without a workspace and validates each response", async () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    expect(tools.list()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "ask_user" })]),
    );
    await expect(
      tools.inspect("ask_user", clarification),
    ).resolves.toMatchObject({
      ok: true,
      requiresApproval: false,
      input: { kind: "clarification", title: clarification.title },
    });
    await expect(
      tools.completeUserInput?.("ask_user", clarification, {
        answers: [
          { questionId: "audience", answerIds: ["team"] },
          { questionId: "date", text: "2026-10-01" },
        ],
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        kind: "clarification",
        answers: [
          { questionId: "audience", answerLabels: ["Internal team"] },
          { questionId: "date", text: "2026-10-01" },
        ],
      },
    });
  });

  it("advertises quizzes without a workspace and validates every answer", async () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    expect(tools.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "render_quiz" }),
      ]),
    );
    await expect(tools.inspect("render_quiz", quiz)).resolves.toMatchObject({
      ok: true,
      requiresApproval: false,
      input: { kind: "quiz", title: quiz.title },
    });
    await expect(
      tools.completeUserInput?.("render_quiz", quiz, {
        answers: [
          { questionId: "gate", answerIds: ["gate"] },
          { questionId: "evidence", answerIds: ["installed", "review"] },
        ],
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        kind: "quiz",
        correct: 2,
        total: 2,
      },
    });
  });

  it("rejects incomplete and invented quiz responses", async () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    for (const response of [
      { answers: [{ questionId: "gate", answerIds: ["gate"] }] },
      {
        answers: [
          { questionId: "gate", answerIds: ["invented"] },
          { questionId: "evidence", answerIds: ["review"] },
        ],
      },
    ]) {
      await expect(
        tools.completeUserInput?.("render_quiz", quiz, response),
      ).resolves.toMatchObject({ ok: false });
    }
  });

  it("rejects duplicate ids and invalid correct answer sets before display", async () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    await expect(
      tools.inspect("ask_user", {
        title: "Duplicate",
        questions: [clarification.questions[0], clarification.questions[0]],
      }),
    ).resolves.toMatchObject({ ok: false, correctable: true });
    await expect(
      tools.inspect("render_quiz", {
        title: "Broken",
        questions: [
          {
            ...quiz.questions[0],
            correctAnswerIds: ["missing"],
          },
        ],
      }),
    ).resolves.toMatchObject({ ok: false, correctable: true });
    await expect(
      tools.inspect("render_quiz", {
        title: "No feedback",
        questions: [{ ...quiz.questions[0], explanation: undefined }],
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("explanation"),
      correctable: true,
    });
  });
});
