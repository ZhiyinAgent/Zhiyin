/**
 * What one specialist run sends: its instructions and task, what it said and
 * was answered, the tools it is offered, and how large all of that is as the
 * provider would count it. What follows its task is kept by the
 * conversation's own history class, in memory, so its pictures, receipts and
 * record follow a turn's rules. When it is asked for its report, nothing else
 * is offered, and its oldest results are set aside until the request fits.
 */

import type {
  ModelHistoryEntry,
  SpecialistDefinition,
  SpecialistTranscriptEntry,
  ToolSpec,
  WorkspaceTask,
} from "@zhiyin/contract";
import { estimatedTokens } from "@zhiyin/context-budget";
import type {
  ModelMessage,
  ModelTool,
  ModelUsage,
  TokenLimitDetail,
} from "@zhiyin/model-client";
import type { AgentLoopDependencies } from "../dependencies.js";
import { estimatedRequestTokens } from "../context/conversation-context.js";
import { RequestSize, type RequestParts } from "../context/request-size.js";
import { selfDescribing, shownSchema } from "../context/self-description.js";
import {
  modelRoundRequest,
  type RequestBefore,
} from "../request/round-request.js";
import { ModelHistory, type SentPicture } from "../context/model-history.js";
import { harnessNotice, isNotice, type NoticeKind } from "../turn/notices.js";

export const finishSpecialistTool: ToolSpec = {
  name: "finish_specialist",
  description: "Finish this specialist run with your report to the main agent.",
  inputSchema: {
    type: "object",
    properties: {
      report: {
        type: "string",
        description:
          "Your whole report, in Markdown: what you found and the evidence for it, what you recommend, and what you could not do or check.",
      },
    },
    required: ["report"],
    additionalProperties: false,
  },
};

/** Why a specialist was asked to report now. */
export type WrapUp = "work" | "context" | "refused";

const wrapUpReasons: Readonly<Record<WrapUp, string>> = {
  work: "Your work budget is used up.",
  context: "Your next request would pass the conversation's context budget.",
  refused: "Your last request was refused as too long for the model.",
};

/** As long as the address of a saved output, a UUID. */
const savedAddressLength = "0".repeat(36);

/**
 * What stands in for a result set aside to make room for a specialist's
 * report. Nothing is offered then but the report, so it names no tool; the
 * main agent can read the address.
 */
function setAsideReceipt(id: string): string {
  return harnessNotice(
    "cleared",
    `This result was set aside to make room for your report. It is saved as output://${id}, which the main agent can read: name that address in your report where the result matters.`,
  );
}

/**
 * A picture handed over with a specialist's task, and the address a tool
 * reads it by, as `compare_pictures` does, where it has one.
 */
export type TaskPicture = SentPicture & { readonly address?: string };

/**
 * What a specialist's task says of the pictures that come with it: how many,
 * and the address of each that has one, in the order they come.
 */
function picturesWithTask(pictures: readonly TaskPicture[]): string {
  const count = pictures.length;
  const said = `${count === 1 ? "A picture comes" : `${count} pictures come`} with the task, drawn for it by Zhiyin.`;
  const named = pictures.flatMap((picture, index) =>
    picture.address ? [`picture ${index + 1}: ${picture.address}`] : [],
  );
  if (!named.length) return said;
  const others =
    named.length < count
      ? "; the others have none, so compare a render saved in the workspace by its path instead"
      : "";
  return `${said} Where a tool takes a picture, as compare_pictures does, name the person's by its address (${named.join("; ")})${others}.`;
}

/** Its task, in Zhiyin's voice, with the pictures handed over with it. */
function taskMessage(
  task: string,
  pictures: readonly TaskPicture[],
  fromZhiyin: boolean,
): ModelMessage {
  const text = harnessNotice(
    "delegation",
    fromZhiyin
      ? `Zhiyin hands you this task: ${task}`
      : `The main agent delegated this task to you: ${task}`,
  );
  if (!pictures.length) return { role: "user", content: text };
  return {
    role: "user",
    content: [
      { kind: "text", text },
      { kind: "text", text: picturesWithTask(pictures) },
      ...pictures.map((picture) => ({
        kind: "image" as const,
        mediaType: picture.mediaType,
        data: picture.data,
      })),
    ],
  };
}

/** What a run's messages use. */
export type SpecialistMessagesDependencies = Pick<
  AgentLoopDependencies,
  "host" | "kept" | "newMessageId"
>;

export class SpecialistMessages {
  readonly #deps: SpecialistMessagesDependencies;
  readonly #taskId: string;
  readonly #runId: string;
  /** The size the conversation's requests are kept under. */
  readonly #budget: () => number;
  /** Its instructions: the start every request repeats. */
  readonly #fixed: readonly ModelMessage[];
  /** Its task, and everything said and answered after it. */
  readonly history: ModelHistory;
  /** The entry that names the pictures handed over with its task. */
  readonly #taskPictures: readonly SpecialistTranscriptEntry[];
  /** What the history last recorded. */
  #recorded: readonly ModelHistoryEntry[] = [];
  /** Each tool as its own code describes it, which a call is checked against. */
  #own: readonly ToolSpec[];
  /** Tools the loop answers itself, offered without a purpose to give. */
  readonly #plain = new Set<ToolSpec>([finishSpecialistTool]);
  /** Why it was asked to report now, once it was. */
  #wrappingUp: WrapUp | undefined;
  /** This run's last request, for what its next one can reuse. */
  readonly #requestsBefore = new Map<string, RequestBefore>();
  /**
   * Its requests' sizes, from the provider's count of the last one and an
   * estimate of what was added since, reasoning sent back included.
   */
  readonly #requestSize = new RequestSize();
  /**
   * How far the provider's count runs above the estimate of a request's
   * messages, from its last count of a request or its refusal of one. A
   * request for the report is fitted by it: what is set aside then changes
   * the request, so no count stands under it.
   */
  #countedOverEstimate = 1;
  /** Its request for the report was refused as too long, and fitted again. */
  #refitted = false;

  constructor(
    deps: SpecialistMessagesDependencies,
    run: {
      readonly taskId: string;
      readonly runId: string;
      readonly budget: () => number;
      readonly fixedMessages: readonly ModelMessage[];
      readonly specialist: SpecialistDefinition;
      readonly task: string;
      /** Pictures handed over with its task, sent with it, each with where it is stored. */
      readonly pictures?: readonly TaskPicture[];
      /** Zhiyin started it, not the main agent. */
      readonly fromZhiyin?: boolean;
      /** The tools its role allows, as their own specs. */
      readonly tools: readonly ToolSpec[];
    },
  ) {
    this.#deps = deps;
    this.#taskId = run.taskId;
    this.#runId = run.runId;
    this.#budget = run.budget;
    const { specialist } = run;
    // Its instructions are the start every request repeats; the task the
    // parent wrote comes after, in Zhiyin's voice, as a request's first
    // message to it.
    this.#fixed = [
      ...run.fixedMessages,
      {
        role: "system",
        content: [
          `You are the ${specialist.name} specialist (${specialist.id}).`,
          specialist.instructions,
          "Work only on the task the main agent delegates to you in the next message. Use ordinary tools when evidence is needed; every tool remains subject to the parent's permission policy.",
          ...(specialist.access === "read"
            ? [
                "This role can only read. Report any needed changes to the parent.",
              ]
            : []),
          "Finish by calling finish_specialist once, with your report to the main agent as one Markdown text. Do not address the person directly.",
        ].join("\n"),
      },
    ];
    // The pictures that come with its task are kept by where they are
    // stored, as a tool's are, and sent with the task, which never changes.
    this.#taskPictures = run.pictures?.length
      ? [
          {
            id: deps.newMessageId(),
            kind: "pictures",
            text: picturesWithTask(run.pictures),
            pictures: run.pictures.map(({ mediaType, source }) => ({
              mediaType,
              source,
            })),
          },
        ]
      : [];
    this.history = ModelHistory.inMemory(
      taskMessage(run.task, run.pictures ?? [], run.fromZhiyin === true),
      {
        newId: deps.newMessageId,
        save: async (entries) => {
          this.#recorded = entries;
        },
      },
    );
    this.#own = [...run.tools, finishSpecialistTool];
  }

  /** Every message the run has sent or will send next, as it stands. */
  get all(): readonly ModelMessage[] {
    return [...this.#fixed, ...this.history.messages()];
  }

  /** What it said and was answered after its instructions and task, as sent. */
  get transcript(): readonly SpecialistTranscriptEntry[] {
    return [
      ...this.#taskPictures,
      ...this.#recorded.filter(
        (entry): entry is SpecialistTranscriptEntry => entry.kind !== "message",
      ),
    ];
  }

  /** The tools it is offered, as their own specs. */
  get own(): readonly ToolSpec[] {
    return this.#own;
  }

  get wrappingUp(): WrapUp | undefined {
    return this.#wrappingUp;
  }

  async notice(kind: NoticeKind, text: string): Promise<void> {
    await this.history.notice(kind, text);
  }

  /** Tools the loop answers itself, offered first and as they are. */
  offerFirst(tools: readonly ToolSpec[]): void {
    for (const tool of tools) this.#plain.add(tool);
    this.#own = [...tools, ...this.#own];
  }

  /** The tools as offered, with the purpose every call gives (ADR 0014). */
  advertised(): readonly ToolSpec[] {
    return this.#own.map((tool) =>
      this.#plain.has(tool) ? shownSchema(tool) : selfDescribing(tool),
    );
  }

  /** The parts of the next request, offering `tools`. */
  parts(tools: readonly ToolSpec[]): RequestParts {
    const window = this.#deps.host.modelWindow();
    return {
      model: window.model,
      fixed: this.#fixed,
      history: this.history.messages(),
      tools: tools as readonly ModelTool[],
      counting: { reasoning: window.reasoningSentBack === true },
    };
  }

  /** A request's size, and whether a provider's count stands under it. */
  size(parts: RequestParts): {
    readonly tokens: number;
    readonly measured: boolean;
  } {
    return this.#requestSize.of(this.#runId, parts);
  }

  /** The same round a turn asks, gathered without being shown. */
  request(task: WorkspaceTask, offered: readonly ToolSpec[]) {
    return modelRoundRequest(
      task,
      this.#deps.host.reasoningControls(),
      this.all,
      offered,
      this.#fixed.length,
      this.#requestsBefore,
      this.history.firstPictureThatCanGo(),
    );
  }

  /** The provider's count of the request `parts` made. */
  counted(parts: RequestParts, usage: ModelUsage): void {
    this.#requestSize.counted(this.#runId, parts, usage);
    this.#countedOverEstimate = Math.max(
      1,
      this.size(parts).tokens / this.#estimatedMessages(parts),
    );
  }

  /**
   * Learns from a refusal as too long what the provider counts. Answers the
   * size the request is planned from: the provider's count where it stands
   * under the request, else as the provider would count it, since a request
   * for the report has no count under it.
   */
  refused(
    said: TokenLimitDetail,
    parts: RequestParts,
    size: { readonly tokens: number; readonly measured: boolean },
  ): number {
    const planned = size.measured
      ? size.tokens
      : Math.max(size.tokens, this.#scaledSize(parts));
    if (said.sent)
      this.#countedOverEstimate = Math.max(
        this.#countedOverEstimate,
        said.sent / this.#estimatedMessages(parts),
      );
    return planned;
  }

  /** Asks for the report now, with nothing else on offer, made to fit. */
  async wrapUp(why: WrapUp): Promise<void> {
    this.#wrappingUp = why;
    this.#own = [finishSpecialistTool];
    await this.notice(
      "wrapUp",
      `${wrapUpReasons[why]} Call finish_specialist now with what you have found so far, and say in your report what you did not finish.`,
    );
    await this.#fitForReport();
  }

  /**
   * Fits the request for the report again, once, to the smaller window a
   * refusal showed. Answers whether anything more was set aside.
   */
  async refitOnce(): Promise<boolean> {
    if (this.#refitted || !(await this.#fitForReport())) return false;
    this.#refitted = true;
    return true;
  }

  /** Its messages' size, estimated, with no provider's count under it. */
  #estimatedMessages(parts: RequestParts): number {
    return estimatedRequestTokens(
      [...parts.fixed, ...parts.history],
      [],
      parts.counting,
    );
  }

  /**
   * A request's size as the provider would count it: its messages scaled by
   * how far the counts ran above their estimate, and its tools as estimated.
   * The ratio is taken over the messages alone, as if the tools it was
   * measured with cost nothing, so a request carrying fewer tools is never
   * thought smaller than it is.
   */
  #scaledSize(parts: RequestParts): number {
    return (
      this.#estimatedMessages(parts) * this.#countedOverEstimate +
      estimatedRequestTokens([], parts.tools)
    );
  }

  /**
   * The request for its report, made to fit the budget as the provider would
   * count it: its oldest results are saved and set aside, one at a time,
   * until it does. One that cannot be saved, or that is no longer than what
   * would stand in for it, stays as it is. Answers whether any was set aside.
   */
  async #fitForReport(): Promise<boolean> {
    let any = false;
    for (const { entryId, content } of this.history.results()) {
      if (this.#scaledSize(this.parts(this.advertised())) <= this.#budget())
        break;
      // What already stands in for a result is never set aside again.
      if (
        isNotice(content, "cleared") ||
        estimatedTokens(content) <=
          estimatedTokens(setAsideReceipt(savedAddressLength))
      )
        continue;
      const kept = await this.#deps.kept
        .keep("output", this.#taskId, { text: content })
        .catch(() => undefined);
      if (kept?.status !== "kept") continue;
      await this.history.replaceResults(
        new Map([[entryId, setAsideReceipt(kept.id)]]),
      );
      any = true;
    }
    return any;
  }
}
