import type {
  CommandOutput,
  RunningCommand,
  FolderInstructions,
  ShellAvailability,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
  UserInputResponse,
  WorkspaceContext,
  WorkspaceDescription,
} from "@zhiyin/contract";
import {
  inspectReadTextFile,
  readFileSpec,
  runReadTextFile,
} from "./read-file.js";
import { inspectReadFiles, readFilesSpec, runReadFiles } from "./read-files.js";
import type { PdfPagesSource } from "./read-pdf.js";
import {
  inspectReadDocument,
  readDocumentSpec,
  runReadDocument,
} from "./read-document.js";
import {
  closeDocumentSpec,
  inspectCloseDocument,
  runCloseDocument,
} from "./close-document.js";
import {
  describeWorkspaceRoot,
  inspectListDirectory,
  listDirectorySpec,
  runListDirectory,
} from "./list-directory.js";
import {
  inspectWriteTextFile,
  runWriteTextFile,
  writeFileSpec,
} from "./write-file.js";
import { inspectMultiEdit, multiEditSpec, runMultiEdit } from "./multi-edit.js";
import {
  inspectSearchFiles,
  runSearchFiles,
  searchFilesSpec,
} from "./search-files.js";
import { findFilesSpec, inspectFindFiles, runFindFiles } from "./find-files.js";
import { bundledRipgrep } from "./ripgrep.js";
import {
  defaultCheckedUpTo,
  defaultFilesKept,
  type CommandFiles,
} from "./command-files.js";
import {
  inspectRunCommand,
  runCommandSpec,
  runShellCommand,
  type CommandContainment,
} from "./run-command.js";
import {
  resolveShell,
  shellAvailability as probeShellAvailability,
  shellUnavailable,
} from "./shell.js";
import { basename, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { renderDiagram } from "./render-diagram.js";
import { renderBarChart } from "./render-bar-chart.js";
import { renderLineChart } from "./render-line-chart.js";
import { renderScatterPlot } from "./render-scatter-plot.js";
import { renderHistogram } from "./render-histogram.js";
import { renderBoxPlot } from "./render-box-plot.js";
import { askUser, renderQuiz } from "./user-input.js";
import { keptAddress, type ConversationItems } from "./conversation-items.js";
import { readFolderInstructions } from "./folder-instructions.js";
import { DeleteFiles, deleteFileSpec, type RecycleBin } from "./delete-file.js";
import {
  CommandJobs,
  inspectJobCall,
  jobOutputSpec,
  stopJobSpec,
  type CommandEnded,
  type CommandsChanged,
  type JobChanges,
} from "./command-jobs.js";

/** Typed data, never a rendered string and never a magic sentinel value. */
export type ToolResult = ToolInvocationResult;

export type { ShellAvailability, ToolCallInspection, ToolSpec };
export { resolveShell, probeShellAvailability as shellAvailability };

/**
 * A lookup table, not a place for tool-specific logic.
 *
 * Inspection is asynchronous because some actions cannot be described
 * accurately without looking at the workspace first — whether a write creates
 * a file or replaces one is the difference the person approving it most needs
 * to see.
 */
export interface ToolRegistry {
  /**
   * What the conversation may call: the file tools only once it has a folder,
   * except reading what it kept by its own addresses.
   */
  list(conversationId?: string): readonly ToolSpec[];
  inspect(
    name: string,
    args: unknown,
    conversationId?: string,
  ): Promise<ToolCallInspection>;
  execute(
    name: string,
    args: unknown,
    signal?: AbortSignal,
    /** The conversation the call belongs to, for what it kept. */
    conversationId?: string,
    /** The most of its answer the model is shown, for a tool that pages. */
    answerTokens?: number,
  ): Promise<ToolResult>;
  completeUserInput?(
    name: string,
    args: unknown,
    response: UserInputResponse,
  ): Promise<ToolResult>;
  /** Whether the shell tool can run here, and why not when it can't. */
  shellAvailability?(): ShellAvailability;
  /** Re-detects the shell without restarting, updating what `list()` offers. */
  recheckShell?(): ShellAvailability;
  /**
   * Told when a conversation's command, carried on as a job, ends by itself,
   * or is stopped by the person.
   */
  onCommandEnded?(listener: CommandEnded): void;
  /** Told when a conversation's running jobs change. */
  onCommandsChanged?(watcher: CommandsChanged): void;
  /** Told what changed in the folder while a job ran, once it has ended. */
  onJobChanges?(watcher: JobChanges): void;
  /** A conversation's running jobs, for the person to see. */
  runningCommands?(conversationId: string): readonly RunningCommand[];
  /** What a running job has printed so far; nothing once it has ended. */
  commandOutput?(
    conversationId: string,
    jobId: string,
  ): Promise<CommandOutput | undefined>;
  /** Stops a job because the person asked, and tells the conversation. */
  stopCommandForPerson?(conversationId: string, jobId: string): Promise<void>;
  /** Stops a conversation's jobs, with everything they started. */
  stopCommands?(conversationId: string): Promise<void>;
  stopAllCommands?(): Promise<void>;
}

/**
 * The folder a call works in: the conversation's, or the registry's own when
 * the conversation entered none.
 */
type Folder = {
  /** Where paths resolve. With no folder, where Zhiyin runs, and unused. */
  readonly root: string;
  readonly available: boolean;
};

type ToolDefinition = {
  readonly spec: ToolSpec;
  readonly inspect: (
    args: unknown,
    conversationId: string | undefined,
    folder: Folder,
  ) => Promise<ToolCallInspection>;
  readonly execute: (
    args: unknown,
    signal: AbortSignal | undefined,
    conversationId: string | undefined,
    folder: Folder,
    answerTokens: number | undefined,
  ) => Promise<ToolResult>;
  /**
   * Whether the call needs a chosen folder. A tool that also reads what a
   * conversation kept is offered without one, and answers by the call.
   */
  readonly requiresWorkspace: boolean | ((args: unknown) => boolean);
  /** Withdrawn, dynamically, when no shell is currently resolved. */
  readonly requiresShell?: boolean;
  readonly completeUserInput?: (
    args: unknown,
    response: UserInputResponse,
  ) => Promise<ToolResult>;
};

export type WorkspaceToolsOptions = {
  /**
   * Whether the model this workspace is working for can be shown a picture.
   * Supplied by the application: this feature knows what an image is and
   * nothing about which model is configured, and silence is read as no.
   */
  readonly acceptsImages?: (() => boolean) | undefined;
  /**
   * Where a real bash lives. Resolved from the machine when not given; when
   * nothing is found the shell tool is not advertised at all, because a
   * capability that cannot run must not look available.
   */
  readonly shell?: string | undefined;
  /**
   * Containment for the process trees a command creates. Supplied by the
   * application so this feature stays testable on its own; when absent, a
   * command still runs and is still stopped by the tree walk, which cannot
   * reach a detached descendant or survive this process dying.
   */
  readonly containment?: CommandContainment | undefined;
  /**
   * Why the application cannot contain commands here, when it cannot. The
   * shell tool is then never offered, even with a shell present, and a
   * re-check does not change that.
   */
  readonly uncontained?: string | undefined;
  /**
   * What each conversation kept that a tool can reach: a command's whole
   * output, pasted text, and when each file was last read. Supplied by the
   * application; without it, those are not offered.
   */
  readonly items?: ConversationItems | undefined;
  /**
   * Where a PDF is opened, read and drawn for the model. The application gives
   * a contained process (ADR 0023); without one it happens in this process.
   */
  readonly pdfPages?: PdfPagesSource | undefined;
  /**
   * The person's Recycle Bin. Supplied by the application, which can reach
   * it; without it, every deletion is shown as permanent.
   */
  readonly recycleBin?: RecycleBin | undefined;
  /**
   * Where ripgrep is. The bundled one when not given; when there is none, the
   * searches by content and by name are not offered.
   */
  readonly ripgrep?: string | undefined;
  /** How long a command runs before it carries on as a job. Defaults to 30 s. */
  readonly promoteCommandsAfterMs?: number | undefined;
  /** The most files a folder may hold for what commands change to be checked. */
  readonly checkCommandsUpTo?: number | undefined;
  /** Files named on one command's action; the rest are counted. */
  readonly commandFilesKept?: number | undefined;
};

async function existingFolder(path: string): Promise<string> {
  const target = await realpath(path);
  if (!(await stat(target)).isDirectory())
    throw new Error("Choose an existing folder.");
  return target;
}

function needsWorkspace(definition: ToolDefinition, args: unknown): boolean {
  return typeof definition.requiresWorkspace === "function"
    ? definition.requiresWorkspace(args)
    : definition.requiresWorkspace;
}

/** A read of what the conversation kept, which needs no folder. */
function readsKeptItem(args: unknown): boolean {
  const path =
    args && typeof args === "object"
      ? (args as Record<string, unknown>)["path"]
      : undefined;
  return typeof path === "string" && keptAddress(path) !== undefined;
}

function readsAttachment(args: unknown): boolean {
  const path = (args as { readonly path?: unknown } | undefined)?.path;
  return typeof path === "string" && keptAddress(path)?.kind === "attachment";
}

/** Where a path resolves when no folder is open; never worked in. */
const noFolder = resolve(".");

export class WorkspaceTools implements ToolRegistry, WorkspaceContext {
  /**
   * The folder a call works in when it names no conversation, or one that
   * entered no folder.
   */
  readonly #folder: string | undefined;
  /** Each conversation's folder, once it has entered one. ADR 0008. */
  readonly #folders = new Map<string, string>();
  #shell: string | undefined;
  readonly #commandsWithheld: string | undefined;
  readonly #containment: CommandContainment | undefined;
  readonly #acceptsImages: (() => boolean) | undefined;
  readonly #items: ConversationItems | undefined;
  readonly #pdfPages: PdfPagesSource | undefined;
  readonly #definitions: ReadonlyMap<string, ToolDefinition>;
  readonly #jobs = new CommandJobs();

  /**
   * `workspaceRoot` is the folder of a registry that serves one folder: the
   * one a call works in when it names no conversation, or names one that
   * entered none. The app gives none, and each conversation enters its own.
   */
  constructor(workspaceRoot?: string, options: WorkspaceToolsOptions = {}) {
    // An empty name is no folder: resolved, it would be wherever Zhiyin was
    // started.
    this.#folder = workspaceRoot ? resolve(workspaceRoot) : undefined;
    this.#commandsWithheld =
      options.uncontained === undefined
        ? undefined
        : `Zhiyin cannot contain what a command starts on this computer, so it runs none. ${options.uncontained}`;
    this.#shell = this.#commandsWithheld
      ? undefined
      : "shell" in options
        ? options.shell
        : resolveShell();
    this.#containment = options.containment;
    this.#acceptsImages = options.acceptsImages;
    this.#items = options.items;
    this.#pdfPages = options.pdfPages;
    const deletion = new DeleteFiles(options.recycleBin);
    const rg = "ripgrep" in options ? options.ripgrep : bundledRipgrep();
    const search = rg ? { rg, containment: options.containment } : undefined;
    const files: CommandFiles = {
      search,
      upTo: options.checkCommandsUpTo ?? defaultCheckedUpTo,
      kept: options.commandFilesKept ?? defaultFilesKept,
    };
    this.#definitions = new Map<string, ToolDefinition>([
      [
        listDirectorySpec.name,
        {
          spec: listDirectorySpec,
          requiresWorkspace: true,
          inspect: async (args, _id, { root }) =>
            inspectListDirectory(root, args),
          execute: (args, signal, _id, { root }) =>
            runListDirectory(root, args, signal),
        },
      ],
      [
        readDocumentSpec.name,
        {
          spec: readDocumentSpec,
          // Offered without a folder only to look again at an attached picture.
          requiresWorkspace: options.items
            ? (args) => !readsAttachment(args)
            : true,
          inspect: async (args, _id, { root }) =>
            inspectReadDocument(root, args),
          execute: (args, signal, conversationId, { root }) =>
            runReadDocument(root, args, signal, {
              acceptsImages: this.#acceptsImages?.() ?? false,
              ...(this.#pdfPages ? { pdfPages: this.#pdfPages } : {}),
              ...(conversationId ? { conversationId } : {}),
              ...(this.#items ? { items: this.#items } : {}),
            }),
        },
      ],
      [
        closeDocumentSpec.name,
        {
          spec: closeDocumentSpec,
          requiresWorkspace: true,
          inspect: async () => inspectCloseDocument(),
          execute: async () => runCloseDocument(),
        },
      ],
      [
        readFileSpec.name,
        {
          spec: readFileSpec,
          // Offered without a folder only when there is something kept to read.
          requiresWorkspace: options.items
            ? (args) => !readsKeptItem(args)
            : true,
          inspect: async (args, _id, { root }) =>
            inspectReadTextFile(root, args),
          execute: (
            args,
            signal,
            conversationId,
            { root, available },
            answerTokens,
          ) =>
            runReadTextFile(root, args, signal, {
              workspace: available,
              ...(conversationId ? { conversationId } : {}),
              ...(this.#items ? { items: this.#items } : {}),
              ...(answerTokens !== undefined ? { tokens: answerTokens } : {}),
            }),
        },
      ],
      [
        readFilesSpec.name,
        {
          spec: readFilesSpec,
          requiresWorkspace: true,
          inspect: async (args, _id, { root }) => inspectReadFiles(root, args),
          execute: (
            args,
            signal,
            conversationId,
            { root, available },
            answerTokens,
          ) =>
            runReadFiles(root, args, signal, {
              workspace: available,
              ...(conversationId ? { conversationId } : {}),
              ...(this.#items ? { items: this.#items } : {}),
              ...(answerTokens !== undefined ? { tokens: answerTokens } : {}),
            }),
        },
      ],
      ...(search
        ? ([
            [
              searchFilesSpec.name,
              {
                spec: searchFilesSpec,
                requiresWorkspace: true,
                inspect: async (
                  args: unknown,
                  _id: string | undefined,
                  { root }: Folder,
                ) => inspectSearchFiles(root, args),
                execute: (
                  args: unknown,
                  signal: AbortSignal | undefined,
                  _id: string | undefined,
                  { root }: Folder,
                ) => runSearchFiles(root, args, signal, search),
              },
            ],
            [
              findFilesSpec.name,
              {
                spec: findFilesSpec,
                requiresWorkspace: true,
                inspect: async (
                  args: unknown,
                  _id: string | undefined,
                  { root }: Folder,
                ) => inspectFindFiles(root, args),
                execute: (
                  args: unknown,
                  signal: AbortSignal | undefined,
                  _id: string | undefined,
                  { root }: Folder,
                ) => runFindFiles(root, args, signal, search),
              },
            ],
          ] as const)
        : []),
      [
        writeFileSpec.name,
        {
          spec: writeFileSpec,
          requiresWorkspace: true,
          inspect: (args, conversationId, { root }) =>
            inspectWriteTextFile(root, args, {
              items: this.#items,
              conversationId,
            }),
          execute: (args, signal, conversationId, { root }) =>
            runWriteTextFile(root, args, signal, {
              items: this.#items,
              conversationId,
            }),
        },
      ],
      [
        multiEditSpec.name,
        {
          spec: multiEditSpec,
          requiresWorkspace: true,
          inspect: (args, conversationId, { root }) =>
            inspectMultiEdit(root, args, {
              items: this.#items,
              conversationId,
            }),
          execute: (args, signal, conversationId, { root }) =>
            runMultiEdit(root, args, signal, {
              items: this.#items,
              conversationId,
            }),
        },
      ],
      [
        deleteFileSpec.name,
        {
          spec: deleteFileSpec,
          requiresWorkspace: true,
          inspect: (args, conversationId, { root }) =>
            deletion.inspect(root, args, conversationId),
          execute: (args, signal, conversationId, { root }) =>
            deletion.execute(root, args, signal, conversationId),
        },
      ],
      [
        runCommandSpec.name,
        {
          spec: runCommandSpec,
          requiresWorkspace: true,
          requiresShell: true,
          inspect: async (args: unknown) => inspectRunCommand(args),
          execute: (
            args: unknown,
            signal: AbortSignal | undefined,
            conversationId: string | undefined,
            { root }: Folder,
          ) =>
            runShellCommand(this.#shell as string, root, args, {
              signal,
              containment: this.#containment,
              context: {
                ...(conversationId ? { conversationId } : {}),
                ...(this.#items ? { items: this.#items } : {}),
                jobs: this.#jobs,
                files,
                ...(options.promoteCommandsAfterMs === undefined
                  ? {}
                  : { promoteAfterMs: options.promoteCommandsAfterMs }),
              },
            }),
        },
      ],
      // Only a contained command can become a job, so without containment
      // there is never one to ask about.
      ...(options.containment
        ? [jobOutputSpec, stopJobSpec].map(
            (spec) =>
              [
                spec.name,
                {
                  spec,
                  requiresWorkspace: true,
                  requiresShell: true,
                  inspect: async (args: unknown) =>
                    inspectJobCall(spec.name, args),
                  execute: (
                    args: unknown,
                    signal: AbortSignal | undefined,
                    conversationId: string | undefined,
                  ) =>
                    spec === jobOutputSpec
                      ? this.#jobs.output(conversationId ?? "", args, signal)
                      : this.#jobs.stop(conversationId ?? "", args),
                },
              ] as [string, ToolDefinition],
          )
        : []),
      ...[
        renderDiagram,
        renderBarChart,
        renderLineChart,
        renderScatterPlot,
        renderHistogram,
        renderBoxPlot,
        askUser,
        renderQuiz,
      ].map(
        (tool) =>
          [tool.spec.name, { ...tool, requiresWorkspace: false }] as [
            string,
            ToolDefinition,
          ],
      ),
    ]);
  }

  onJobChanges(listener: JobChanges): void {
    this.#jobs.onJobChanges(listener);
  }

  /** Told when a conversation's job ends by itself, or the person stops it. */
  onCommandEnded(listener: CommandEnded): void {
    this.#jobs.onEnded(listener);
  }

  onCommandsChanged(watcher: CommandsChanged): void {
    this.#jobs.onChanged(watcher);
  }

  runningCommands(conversationId: string): readonly RunningCommand[] {
    return this.#jobs.running(conversationId);
  }

  commandOutput(
    conversationId: string,
    jobId: string,
  ): Promise<CommandOutput | undefined> {
    return this.#jobs.printed(conversationId, jobId);
  }

  stopCommandForPerson(conversationId: string, jobId: string): Promise<void> {
    return this.#jobs.stopForPerson(conversationId, jobId);
  }

  /** Stops a conversation's jobs, with everything they started. */
  stopCommands(conversationId: string): Promise<void> {
    return this.#jobs.stopAll(conversationId);
  }

  stopAllCommands(): Promise<void> {
    return this.#jobs.stopEverything();
  }

  list(conversationId?: string): readonly ToolSpec[] {
    const available = this.workspaceRoot(conversationId) !== undefined;
    return [...this.#definitions.values()]
      .filter(
        (definition) => available || definition.requiresWorkspace !== true,
      )
      .filter((definition) => this.#shell || !definition.requiresShell)
      .map(({ spec }) => spec);
  }

  /** Whether the shell tool can run here, and why not when it can't. */
  shellAvailability(): ShellAvailability {
    if (this.#commandsWithheld)
      return { available: false, reason: this.#commandsWithheld };
    return this.#shell ? { available: true } : shellUnavailable;
  }

  /** Re-detects the shell without restarting, updating what `list()` offers. */
  recheckShell(
    environment: NodeJS.ProcessEnv = process.env,
  ): ShellAvailability {
    if (!this.#commandsWithheld) this.#shell = resolveShell(environment);
    return this.shellAvailability();
  }

  /**
   * A conversation moves only once the new path resolves to an existing
   * folder. A change that fails is a change that did not happen: it keeps the
   * folder it had.
   */
  async enterFolder(conversationId: string, path: string): Promise<string> {
    const target = await existingFolder(path);
    this.#folders.set(conversationId, target);
    return basename(target);
  }

  async checkFolder(path: string): Promise<string> {
    return basename(await existingFolder(path));
  }

  leaveFolder(conversationId: string): void {
    this.#folders.delete(conversationId);
  }

  /**
   * Where a conversation's folder really is. The conversation is a required
   * argument, `undefined` when the caller names none, so a caller cannot
   * leave it out by mistake.
   */
  workspaceRoot(conversationId: string | undefined): string | undefined {
    return (
      (conversationId === undefined
        ? undefined
        : this.#folders.get(conversationId)) ?? this.#folder
    );
  }

  #folderOf(conversationId: string | undefined): Folder {
    const root = this.workspaceRoot(conversationId);
    return root === undefined
      ? { root: noFolder, available: false }
      : { root, available: true };
  }

  /** The folder's AGENTS.md, when it has one. ADR 0017. */
  folderInstructions(
    conversationId: string | undefined,
  ): Promise<FolderInstructions | undefined> {
    const root = this.workspaceRoot(conversationId);
    return root === undefined
      ? Promise.resolve(undefined)
      : readFolderInstructions(root);
  }

  describeWorkspace(
    conversationId: string | undefined,
  ): Promise<WorkspaceDescription> {
    const root = this.workspaceRoot(conversationId);
    if (root === undefined)
      return Promise.resolve({
        rootName: "No folder selected",
        entries: [],
        truncated: false,
      });
    return describeWorkspaceRoot(root);
  }

  async inspect(
    name: string,
    args: unknown,
    conversationId?: string,
  ): Promise<ToolCallInspection> {
    const definition = this.#definitions.get(name);
    const folder = this.#folderOf(conversationId);
    if (definition && needsWorkspace(definition, args) && !folder.available)
      return { ok: false, reason: "Choose a folder before using files." };
    if (definition?.requiresShell && !this.#shell)
      return { ok: false, reason: `The tool “${name}” is not available.` };
    return definition
      ? definition.inspect(args, conversationId, folder)
      : { ok: false, reason: `The tool “${name}” is not available.` };
  }

  async execute(
    name: string,
    args: unknown,
    signal?: AbortSignal,
    conversationId?: string,
    answerTokens?: number,
  ): Promise<ToolResult> {
    const definition = this.#definitions.get(name);
    const folder = this.#folderOf(conversationId);
    if (definition && needsWorkspace(definition, args) && !folder.available)
      return { ok: false, reason: "Choose a folder before using files." };
    if (definition?.requiresShell && !this.#shell)
      return { ok: false, reason: `The tool “${name}” is not available.` };
    return definition
      ? definition.execute(args, signal, conversationId, folder, answerTokens)
      : { ok: false, reason: `The tool “${name}” is not available.` };
  }

  async completeUserInput(
    name: string,
    args: unknown,
    response: UserInputResponse,
  ): Promise<ToolResult> {
    const definition = this.#definitions.get(name);
    return definition?.completeUserInput
      ? definition.completeUserInput(args, response)
      : {
          ok: false,
          reason: `The tool “${name}” is not waiting for user input.`,
        };
  }
}
