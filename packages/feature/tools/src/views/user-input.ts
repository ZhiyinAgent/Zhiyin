import { createHash } from "node:crypto";
import type {
  ClarificationQuestion,
  QuizAnswer,
  QuizQuestion,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
  UserInputRequest,
  UserInputResponse,
} from "@zhiyin/contract";
import {
  correctable,
  inputProblems,
  withoutSpacesAround,
} from "./view-tool.js";

/** A question for the person, which needs no folder. */
type InputTool = {
  readonly spec: ToolSpec;
  readonly requiresWorkspace: false;
  readonly inspect: (args: unknown) => Promise<ToolCallInspection>;
  readonly execute: () => Promise<ToolInvocationResult>;
  readonly completeUserInput: (
    args: unknown,
    response: UserInputResponse,
  ) => Promise<ToolInvocationResult>;
};

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/** Clarifying questions, as their schema has them. */
type ClarificationInput = {
  readonly title: string;
  readonly questions: readonly (Omit<ClarificationQuestion, "allowText"> & {
    readonly allowText?: boolean;
    readonly allowOther?: boolean;
  })[];
};

function clarificationFrom(
  input: ClarificationInput,
): UserInputRequest | string {
  const parsed: ClarificationQuestion[] = [];
  for (const question of input.questions) {
    const { options } = question;
    if (options && !unique(options.map((choice) => choice.id)))
      return "Option ids must be unique within a question.";
    const allowText =
      question.allowText === true || question.allowOther === true;
    if (!options && !allowText)
      return "Every clarification question must offer choices or allow a written answer.";
    parsed.push({
      id: question.id,
      prompt: question.prompt,
      ...(options ? { options } : {}),
      ...(allowText ? { allowText: true } : {}),
    });
  }
  if (!unique(parsed.map((question) => question.id)))
    return "Question ids must be unique.";
  return { kind: "clarification", title: input.title, questions: parsed };
}

/** A plain number, such as 12, -2, 3.5 or 40%. */
function numberIn(label: string): number | undefined {
  const match = /^([+-]?\d+(?:\.\d+)?)\s*%?$/.exec(label.trim());
  return match ? Number(match[1]) : undefined;
}

/**
 * The answers in the order the person sees them, which is not the order the
 * model wrote them in: weak models tend to write the correct answer first.
 * The order comes from the quiz's own words, so the same quiz is always shown
 * the same way, whenever it is read. Answers that are all numbers are shown
 * from smallest to largest instead.
 */
function shownOrder(
  title: string,
  question: { readonly id: string; readonly prompt: string },
  answers: readonly QuizAnswer[],
): QuizAnswer[] {
  const numbers = answers.map((answer) => numberIn(answer.label));
  if (numbers.every((value) => value !== undefined))
    return answers
      .map((answer, index) => ({ answer, value: numbers[index]! }))
      .sort((left, right) => left.value - right.value)
      .map(({ answer }) => answer);
  const seed = createHash("sha256")
    .update(JSON.stringify([title, question.id, question.prompt, answers]))
    .digest();
  const order = [...answers];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = seed.readUInt32BE((index - 1) * 4) % (index + 1);
    [order[index], order[other]] = [order[other]!, order[index]!];
  }
  return order;
}

/** True when the correct answers are plainly the longest, which gives them away. */
function standsOutByLength(
  answers: readonly QuizAnswer[],
  correct: readonly string[],
): boolean {
  const lengths = (right: boolean) =>
    answers
      .filter((answer) => correct.includes(answer.id) === right)
      .map((answer) => answer.label.length);
  const wrong = lengths(false);
  if (wrong.length === 0) return false;
  const shortestCorrect = Math.min(...lengths(true));
  const longestWrong = Math.max(...wrong);
  return (
    shortestCorrect > longestWrong * 1.5 && shortestCorrect - longestWrong >= 25
  );
}

/** A quiz, as its schema has it. */
type QuizInput = {
  readonly title: string;
  readonly questions: readonly QuizQuestion[];
};

function quizFrom(input: QuizInput): UserInputRequest | string {
  const parsed: QuizQuestion[] = [];
  for (const question of input.questions) {
    const { correctAnswerIds } = question;
    // In one order of fields, whichever the model wrote, so the order they
    // are shown in is the same for the same quiz.
    const answers = question.answers.map(({ id, label }) => ({ id, label }));
    if (!unique(answers.map((answer) => answer.id)))
      return "Answer ids must be unique within a question.";
    if (
      !unique(correctAnswerIds) ||
      correctAnswerIds.some(
        (answerId) => !answers.some((answer) => answer.id === answerId),
      ) ||
      (question.selection === "single" && correctAnswerIds.length !== 1)
    )
      return "Correct answers must be unique offered answers and match the selection mode.";
    if (standsOutByLength(answers, correctAnswerIds))
      return `In question "${question.id}", the correct answer is much longer than the others, which gives it away. Rewrite the answers so that they are similar in length and detail.`;
    parsed.push({
      ...question,
      answers: shownOrder(input.title, question, answers),
    });
  }
  if (!unique(parsed.map((question) => question.id)))
    return "Question ids must be unique.";
  return { kind: "quiz", title: input.title, questions: parsed };
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

/**
 * A question tool: its spec, and how an input that holds to the spec's
 * schema, with no spaces around its texts, becomes what the person is asked,
 * or why it cannot for what a schema cannot say. `what` names it in a
 * refusal, as "The quiz".
 */
function defineInputTool<Input>(
  spec: ToolSpec,
  action: string,
  what: string,
  parseInput: (input: Input) => UserInputRequest | string,
): InputTool {
  const parse = (args: unknown): UserInputRequest | string => {
    const input = withoutSpacesAround(args);
    return (
      inputProblems(input, spec.inputSchema, what) ?? parseInput(input as Input)
    );
  };
  return {
    spec,
    requiresWorkspace: false,
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
      "Pause and ask one to three concise clarifying questions when missing information would materially change the work, instead of guessing. For broad research or document requests, ask before substantial work when the intended audience, scope, source preference, or deliverable format could materially change the result. Ask only about details that are not already clear from the conversation. Prefer offered choices when the options are known; allow text only when needed. This does not grant permission for a later action.",
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
  "The questions",
  clarificationFrom,
);

export const renderQuiz = defineInputTool(
  {
    name: "render_quiz",
    description:
      "Create an interactive, scored quiz that presents and checks one question at a time; use it when a person asks for a quiz. It is shown in the conversation and is not embedded in any file: never write in a file as though the quiz were inside it. The turn waits until the person submits it; you then receive each answer they chose, whether it was right, and their score. Use single selection for one answer and multiple selection when several answers together are correct; a multiple-selection question counts as right only when every correct answer is chosen. Give every question an explanation for the feedback shown after it is checked, saying why the correct answer is correct, and for multiple selection why each correct answer is. The answers are shown in a random order, so never refer to their positions and never write “all of the above”, “none of the above” or “both A and B”. Make every answer similar in length, detail and wording, with plausible wrong answers, so that the correct one does not stand out; a quiz whose correct answer is plainly the longest is sent back to be rewritten.",
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
  "The quiz",
  quizFrom,
);
