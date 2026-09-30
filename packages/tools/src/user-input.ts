import type {
  ClarificationQuestion,
  QuizQuestion,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
  UserInputRequest,
  UserInputResponse,
} from "@zhiyin/contract";
import {
  correctable,
  object,
  optionalText,
  requiredText,
} from "./view-tool.js";

type InputTool = {
  readonly spec: ToolSpec;
  readonly inspect: (args: unknown) => Promise<ToolCallInspection>;
  readonly execute: () => Promise<ToolInvocationResult>;
  readonly completeUserInput: (
    args: unknown,
    response: UserInputResponse,
  ) => Promise<ToolInvocationResult>;
};

const shortId = (value: unknown): string | undefined => requiredText(value, 64);

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function clarificationFrom(args: unknown): UserInputRequest | string {
  const input = object(args);
  const title = requiredText(input?.title, 160);
  const questions = input?.questions;
  if (!title)
    return "title must be non-empty text no longer than 160 characters.";
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3)
    return "questions must contain one to three questions.";

  const parsed: ClarificationQuestion[] = [];
  for (const value of questions) {
    const question = object(value);
    const questionId = shortId(question?.id);
    const prompt = requiredText(question?.prompt, 500);
    if (!questionId || !prompt)
      return "Every question needs a short id and non-empty prompt.";
    const rawOptions = question?.options;
    let options: NonNullable<ClarificationQuestion["options"]> | undefined;
    if (rawOptions !== undefined) {
      if (
        !Array.isArray(rawOptions) ||
        rawOptions.length < 2 ||
        rawOptions.length > 5
      )
        return "Question options must contain two to five choices.";
      const choices: { id: string; label: string; description?: string }[] = [];
      for (const value of rawOptions) {
        const option = object(value);
        const optionId = shortId(option?.id);
        const label = requiredText(option?.label, 160);
        const description = optionalText(option?.description, 240);
        if (!optionId || !label || description === null)
          return "Every option needs a short id, label, and optional short description.";
        choices.push({
          id: optionId,
          label,
          ...(description ? { description } : {}),
        });
      }
      if (!unique(choices.map((choice) => choice.id)))
        return "Option ids must be unique within a question.";
      options = choices;
    }
    const allowText =
      question?.allowText === true || question?.allowOther === true;
    if (!options && !allowText)
      return "Every clarification question must offer choices or allow a written answer.";
    parsed.push({
      id: questionId,
      prompt,
      ...(options ? { options } : {}),
      ...(allowText ? { allowText: true } : {}),
    });
  }
  if (!unique(parsed.map((question) => question.id)))
    return "Question ids must be unique.";
  return { kind: "clarification", title, questions: parsed };
}

function quizFrom(args: unknown): UserInputRequest | string {
  const input = object(args);
  const title = requiredText(input?.title, 160);
  const questions = input?.questions;
  if (!title)
    return "title must be non-empty text no longer than 160 characters.";
  if (
    !Array.isArray(questions) ||
    questions.length < 1 ||
    questions.length > 12
  )
    return "questions must contain one to twelve questions.";

  const parsed: QuizQuestion[] = [];
  for (const value of questions) {
    const question = object(value);
    const questionId = shortId(question?.id);
    const prompt = requiredText(question?.prompt, 500);
    const selection = question?.selection;
    const rawAnswers = question?.answers;
    const rawCorrect = question?.correctAnswerIds;
    const explanation = requiredText(question?.explanation, 1000);
    if (!questionId || !prompt)
      return "Every quiz question needs a short id and non-empty prompt.";
    if (selection !== "single" && selection !== "multiple")
      return "Every quiz question must use single or multiple selection.";
    if (
      !Array.isArray(rawAnswers) ||
      rawAnswers.length < 2 ||
      rawAnswers.length > 8
    )
      return "Every quiz question must offer two to eight answers.";
    const answers: { id: string; label: string }[] = [];
    for (const value of rawAnswers) {
      const answer = object(value);
      const answerId = shortId(answer?.id);
      const label = requiredText(answer?.label, 240);
      if (!answerId || !label)
        return "Every quiz answer needs a short id and non-empty label.";
      answers.push({ id: answerId, label });
    }
    if (!unique(answers.map((answer) => answer.id)))
      return "Answer ids must be unique within a question.";
    if (
      !Array.isArray(rawCorrect) ||
      rawCorrect.length < 1 ||
      rawCorrect.some((answerId) => typeof answerId !== "string") ||
      !unique(rawCorrect as string[]) ||
      rawCorrect.some(
        (answerId) => !answers.some((answer) => answer.id === answerId),
      ) ||
      (selection === "single" && rawCorrect.length !== 1)
    )
      return "Correct answers must be unique offered answers and match the selection mode.";
    if (!explanation)
      return "Every quiz question needs a non-empty explanation no longer than 1000 characters.";
    parsed.push({
      id: questionId,
      prompt,
      answers,
      selection,
      correctAnswerIds: rawCorrect as string[],
      explanation,
    });
  }
  if (!unique(parsed.map((question) => question.id)))
    return "Question ids must be unique.";
  return { kind: "quiz", title, questions: parsed };
}

function responseAnswers(
  response: UserInputResponse,
): Map<string, UserInputResponse["answers"][number]> | string {
  if (!response || !Array.isArray(response.answers))
    return "Every question needs an answer.";
  const map = new Map(
    response.answers.map((answer) => [answer.questionId, answer]),
  );
  if (map.size !== response.answers.length)
    return "A question was answered more than once.";
  return map;
}

function completeClarification(
  request: Extract<UserInputRequest, { kind: "clarification" }>,
  response: UserInputResponse,
): ToolInvocationResult {
  const answers = responseAnswers(response);
  if (typeof answers === "string") return { ok: false, reason: answers };
  if (answers.size !== request.questions.length)
    return { ok: false, reason: "Answer every clarification question." };
  const normalized = [];
  for (const question of request.questions) {
    const answer = answers.get(question.id);
    if (!answer)
      return { ok: false, reason: "Answer every clarification question." };
    const answerIds = answer.answerIds ?? [];
    const text = answer.text?.trim();
    const validChoice =
      answerIds.length === 1 &&
      !text &&
      question.options?.some((option) => option.id === answerIds[0]);
    const validText =
      answerIds.length === 0 && Boolean(text) && question.allowText;
    if (!validChoice && !validText)
      return {
        ok: false,
        reason: `Choose one offered answer for “${question.prompt}” or provide allowed text.`,
      };
    normalized.push({
      questionId: question.id,
      prompt: question.prompt,
      ...(validChoice
        ? {
            answerIds,
            answerLabels: answerIds.map(
              (answerId) =>
                question.options?.find((option) => option.id === answerId)
                  ?.label ?? answerId,
            ),
          }
        : { text }),
    });
  }
  return { ok: true, value: { kind: "clarification", answers: normalized } };
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

function completeQuiz(
  request: Extract<UserInputRequest, { kind: "quiz" }>,
  response: UserInputResponse,
): ToolInvocationResult {
  const answers = responseAnswers(response);
  if (typeof answers === "string") return { ok: false, reason: answers };
  if (answers.size !== request.questions.length)
    return {
      ok: false,
      reason: "Answer every quiz question before submitting.",
    };
  const normalized = [];
  let correct = 0;
  for (const question of request.questions) {
    const answer = answers.get(question.id);
    const answerIds = answer?.answerIds ?? [];
    if (
      !answer ||
      Boolean(answer.text) ||
      answerIds.length < 1 ||
      !unique(answerIds) ||
      (question.selection === "single" && answerIds.length !== 1) ||
      answerIds.some(
        (answerId) =>
          !question.answers.some((choice) => choice.id === answerId),
      )
    )
      return {
        ok: false,
        reason: `Choose valid answers for “${question.prompt}”.`,
      };
    const isCorrect = sameSet(answerIds, question.correctAnswerIds);
    if (isCorrect) correct += 1;
    normalized.push({
      questionId: question.id,
      prompt: question.prompt,
      answerIds,
      answerLabels: answerIds.map(
        (answerId) =>
          question.answers.find((choice) => choice.id === answerId)?.label ??
          answerId,
      ),
      correct: isCorrect,
    });
  }
  return {
    ok: true,
    value: {
      kind: "quiz",
      answers: normalized,
      correct,
      total: request.questions.length,
    },
  };
}

function defineInputTool(
  spec: ToolSpec,
  action: string,
  parse: (args: unknown) => UserInputRequest | string,
): InputTool {
  return {
    spec,
    inspect: async (args) => {
      const request = parse(args);
      return typeof request === "string"
        ? correctable(request)
        : {
            ok: true,
            action,
            target: request.title,
            command: `${spec.name}(${JSON.stringify({ title: request.title })})`,
            requiresApproval: false,
            input: request,
          };
    },
    execute: async () => ({
      ok: false,
      reason: "This request needs a live user response.",
    }),
    completeUserInput: async (args, response) => {
      const request = parse(args);
      if (typeof request === "string") return { ok: false, reason: request };
      return request.kind === "quiz"
        ? completeQuiz(request, response)
        : completeClarification(request, response);
    },
  };
}

export const askUser = defineInputTool(
  {
    name: "ask_user",
    description:
      "Pause and ask one to three concise clarifying questions when missing information would materially change the work. Prefer offered choices when the options are known; allow text only when needed. This does not grant permission for a later action.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1, maxLength: 160 },
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1, maxLength: 64 },
              prompt: { type: "string", minLength: 1, maxLength: 500 },
              options: {
                type: "array",
                minItems: 2,
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string", minLength: 1, maxLength: 64 },
                    label: { type: "string", minLength: 1, maxLength: 160 },
                    description: {
                      type: "string",
                      minLength: 1,
                      maxLength: 240,
                    },
                  },
                  required: ["id", "label"],
                },
              },
              allowText: { type: "boolean" },
              allowOther: { type: "boolean" },
            },
            required: ["id", "prompt"],
          },
        },
      },
      required: ["title", "questions"],
    },
  },
  "Ask for clarification",
  clarificationFrom,
);

export const renderQuiz = defineInputTool(
  {
    name: "render_quiz",
    description:
      "Create an interactive, scored quiz that presents and checks one question at a time. Use single selection for one answer and multiple selection when several answers together are correct. Give every question an explanation for the feedback shown after it is checked.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1, maxLength: 160 },
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1, maxLength: 64 },
              prompt: { type: "string", minLength: 1, maxLength: 500 },
              answers: {
                type: "array",
                minItems: 2,
                maxItems: 8,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string", minLength: 1, maxLength: 64 },
                    label: { type: "string", minLength: 1, maxLength: 240 },
                  },
                  required: ["id", "label"],
                },
              },
              selection: { type: "string", enum: ["single", "multiple"] },
              correctAnswerIds: {
                type: "array",
                minItems: 1,
                maxItems: 8,
                items: { type: "string" },
              },
              explanation: { type: "string", minLength: 1, maxLength: 1000 },
            },
            required: [
              "id",
              "prompt",
              "answers",
              "selection",
              "correctAnswerIds",
              "explanation",
            ],
          },
        },
      },
      required: ["title", "questions"],
    },
  },
  "Create a quiz",
  quizFrom,
);
