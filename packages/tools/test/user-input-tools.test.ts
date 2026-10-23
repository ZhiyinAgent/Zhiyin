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

  it("shows the correct answer in different places when the model always writes it first", async () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    const capitals = [
      ["France", "Paris", "Lyon", "Nice", "Lille"],
      ["Italy", "Rome", "Milan", "Turin", "Genoa"],
      ["Spain", "Madrid", "Seville", "Bilbao", "Malaga"],
      ["Japan", "Tokyo", "Osaka", "Kyoto", "Kobe"],
      ["Canada", "Ottawa", "Toronto", "Calgary", "Quebec"],
      ["Brazil", "Brasilia", "Recife", "Salvador", "Manaus"],
      ["Kenya", "Nairobi", "Mombasa", "Kisumu", "Nakuru"],
      ["Peru", "Lima", "Cusco", "Arequipa", "Trujillo"],
    ];
    const written = {
      title: "Capitals",
      questions: capitals.map(([country, ...cities]) => ({
        id: country!.toLowerCase(),
        prompt: `What is the capital of ${country}?`,
        answers: cities.map((city) => ({
          id: city.toLowerCase(),
          label: city,
        })),
        selection: "single",
        correctAnswerIds: [cities[0]!.toLowerCase()],
        explanation: `${cities[0]} is the capital of ${country}.`,
      })),
    };

    const shown = await tools.inspect("render_quiz", written);
    if (!shown.ok || shown.input?.kind !== "quiz") throw new Error("No quiz");
    const places = shown.input.questions.map((question) =>
      question.answers.findIndex((answer) =>
        question.correctAnswerIds.includes(answer.id),
      ),
    );

    expect(places.filter((place) => place === 0).length).toBeLessThan(4);
    expect(new Set(places).size).toBeGreaterThan(1);
    shown.input.questions.forEach((question, index) =>
      expect(question.answers.map((answer) => answer.label).sort()).toEqual(
        [...capitals[index]!.slice(1)].sort(),
      ),
    );
  });

  it("spreads a correct answer written first evenly over the four places", async () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    const counts = [0, 0, 0, 0];
    for (let quizNumber = 0; quizNumber < 40; quizNumber += 1) {
      const shown = await tools.inspect("render_quiz", {
        title: `Practice ${quizNumber}`,
        questions: Array.from({ length: 10 }, (_, number) => ({
          id: `q${number}`,
          prompt: `Question ${number} of practice ${quizNumber}?`,
          answers: ["right", "near", "far", "off"].map((id) => ({
            id,
            label: `Answer ${id} ${number}`,
          })),
          selection: "single",
          correctAnswerIds: ["right"],
          explanation: "The first one is right.",
        })),
      });
      if (!shown.ok || shown.input?.kind !== "quiz") throw new Error("No quiz");
      for (const question of shown.input.questions)
        counts[
          question.answers.findIndex((answer) => answer.id === "right")
        ]! += 1;
    }

    // 400 questions: a quarter is 100 in each place.
    for (const count of counts) expect(count).toBeGreaterThan(70);
  });

  it("shows the same quiz in the same order every time, and scores it by answer", async () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    const first = await tools.inspect("render_quiz", quiz);
    const again = await tools.inspect("render_quiz", quiz);

    expect(again).toEqual(first);
    await expect(
      tools.completeUserInput?.("render_quiz", quiz, {
        answers: [
          { questionId: "gate", answerIds: ["gate"] },
          { questionId: "evidence", answerIds: ["review", "installed"] },
        ],
      }),
    ).resolves.toMatchObject({ ok: true, value: { correct: 2, total: 2 } });
  });

  it("lists answers that are all numbers from smallest to largest", async () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    const shown = await tools.inspect("render_quiz", {
      title: "Arithmetic",
      questions: [
        {
          id: "sum",
          prompt: "What is 5 + 7?",
          answers: [
            { id: "a", label: "12" },
            { id: "b", label: "3.5" },
            { id: "c", label: "40" },
            { id: "d", label: "-2" },
          ],
          selection: "single",
          correctAnswerIds: ["a"],
          explanation: "Five plus seven is twelve.",
        },
      ],
    });

    expect(shown).toMatchObject({
      ok: true,
      input: {
        questions: [
          {
            answers: [
              { label: "-2" },
              { label: "3.5" },
              { label: "12" },
              { label: "40" },
            ],
          },
        ],
      },
    });
  });

  it("sends a quiz back to the model when its correct answer stands out by length", async () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    const question = (labels: string[], correct: string[]) => ({
      title: "Photosynthesis",
      questions: [
        {
          id: "light",
          prompt: "What does a leaf make from light?",
          answers: labels.map((label, index) => ({ id: `a${index}`, label })),
          selection: correct.length > 1 ? "multiple" : "single",
          correctAnswerIds: correct,
          explanation:
            "Photosynthesis turns light, water and carbon dioxide into sugar.",
        },
      ],
    });
    const long =
      "Sugar, made from water and carbon dioxide, releasing oxygen as it goes";

    await expect(
      tools.inspect(
        "render_quiz",
        question([long, "Salt", "Iron", "Wax"], ["a0"]),
      ),
    ).resolves.toMatchObject({
      ok: false,
      correctable: true,
      reason: expect.stringContaining("similar in length"),
    });
    // A long wrong answer, or a long answer beside a short correct one, gives
    // nothing away.
    await expect(
      tools.inspect(
        "render_quiz",
        question([long, "Sugar", "Iron", "Wax"], ["a1"]),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      tools.inspect(
        "render_quiz",
        question([long, "Sugar", "Iron", "Wax"], ["a0", "a1"]),
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it("tells the model the answers are shuffled and should look alike", () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    const description =
      tools.list().find((tool) => tool.name === "render_quiz")?.description ??
      "";

    expect(description).toContain("random order");
    expect(description).toContain("similar in length");
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
