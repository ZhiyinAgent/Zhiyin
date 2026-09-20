/**
 * The built-in actions the agent can take. Each tool takes typed arguments,
 * performs one action, and returns a typed result. It decides nothing about
 * whether it is allowed to run and renders nothing itself.
 *
 * Boundaries and invariants: docs/architecture/features/tools/README.md
 */

import type {
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
import { inspectReadImage, readImageSpec, runReadImage } from "./read-image.js";
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
import {
  inspectRunCommand,
  resolveShell,
  runCommandSpec,
  runShellCommand,
  shellAvailability as probeShellAvailability,
  shellUnavailable,
  type CommandContainment,
} from "./run-command.js";
import { basename, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { renderDiagram } from "./render-diagram.js";
import { renderBarChart } from "./render-bar-chart.js";
import { renderLineChart } from "./render-line-chart.js";
import { renderScatterPlot } from "./render-scatter-plot.js";
import { renderHistogram } from "./render-histogram.js";
import { renderBoxPlot } from "./render-box-plot.js";
import { askUser, renderQuiz } from "./user-input.js";

/** Typed data, never a rendered string and never a magic sentinel value. */
export type ToolResult = ToolInvocationResult;

export type { ShellAvailability, ToolCallInspection, ToolSpec };
export { resolveShell, probeShellAvailability as shellAvailability };
export type { CommandContainer, CommandContainment } from "./run-command.js";

/**
 * A lookup table, not a place for tool-specific logic.
 *
 * Inspection is asynchronous because some actions cannot be described honestly
 * without looking at the workspace first — whether a write creates a file or
 * replaces one is the difference the person approving it most needs to see.
 */
export interface ToolRegistry {
  list(): readonly ToolSpec[];
  inspect(name: string, args: unknown): Promise<ToolCallInspection>;
  execute(
    name: string,
    args: unknown,
    signal?: AbortSignal,
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
}

type ToolDefinition = {
  readonly spec: ToolSpec;
  /** Only offered when the model can be shown a picture. */
  readonly requiresVision?: boolean;
  readonly inspect: (args: unknown) => Promise<ToolCallInspection>;
  readonly execute: (
    args: unknown,
    signal?: AbortSignal,
  ) => Promise<ToolResult>;
  readonly requiresWorkspace: boolean;
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
};

export class WorkspaceTools implements ToolRegistry, WorkspaceContext {
  #root: string;
  #available: boolean;
  #shell: string | undefined;
  readonly #containment: CommandContainment | undefined;
  readonly #acceptsImages: (() => boolean) | undefined;
  readonly #definitions: ReadonlyMap<string, ToolDefinition>;

  constructor(workspaceRoot?: string, options: WorkspaceToolsOptions = {}) {
    this.#available = workspaceRoot !== undefined;
    const root = resolve(workspaceRoot ?? ".");
    this.#root = root;
    this.#shell = "shell" in options ? options.shell : resolveShell();
    this.#containment = options.containment;
    this.#acceptsImages = options.acceptsImages;
    this.#definitions = new Map<string, ToolDefinition>([
      [
        listDirectorySpec.name,
        {
          spec: listDirectorySpec,
          requiresWorkspace: true,
          inspect: async (args) => inspectListDirectory(this.#root, args),
          execute: (args, signal) => runListDirectory(this.#root, args, signal),
        },
      ],
      [
        readImageSpec.name,
        {
          spec: readImageSpec,
          requiresWorkspace: true,
          // Withdrawn when the answer could not be looked at. A tool whose
          // whole result is a picture is not a capability for a model that
          // cannot be shown one.
          requiresVision: true,
          inspect: async (args) => inspectReadImage(this.#root, args),
          execute: (args, signal) => runReadImage(this.#root, args, signal),
        },
      ],
      [
        readFileSpec.name,
        {
          spec: readFileSpec,
          requiresWorkspace: true,
          inspect: async (args) => inspectReadTextFile(this.#root, args),
          execute: (args, signal) =>
            runReadTextFile(
              this.#root,
              args,
              signal,
              this.#acceptsImages?.() ?? false,
            ),
        },
      ],
      [
        searchFilesSpec.name,
        {
          spec: searchFilesSpec,
          requiresWorkspace: true,
          inspect: async (args) => inspectSearchFiles(this.#root, args),
          execute: (args, signal) => runSearchFiles(this.#root, args, signal),
        },
      ],
      [
        writeFileSpec.name,
        {
          spec: writeFileSpec,
          requiresWorkspace: true,
          inspect: (args) => inspectWriteTextFile(this.#root, args),
          execute: (args, signal) => runWriteTextFile(this.#root, args, signal),
        },
      ],
      [
        multiEditSpec.name,
        {
          spec: multiEditSpec,
          requiresWorkspace: true,
          inspect: (args) => inspectMultiEdit(this.#root, args),
          execute: (args, signal) => runMultiEdit(this.#root, args, signal),
        },
      ],
      [
        runCommandSpec.name,
        {
          spec: runCommandSpec,
          requiresWorkspace: true,
          requiresShell: true,
          inspect: async (args: unknown) =>
            inspectRunCommand(basename(this.#root), args),
          execute: (args: unknown, signal?: AbortSignal) =>
            runShellCommand(
              this.#shell as string,
              this.#root,
              args,
              signal,
              this.#containment,
            ),
        },
      ],
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

  list(): readonly ToolSpec[] {
    const seeing = this.#acceptsImages?.() ?? false;
    return [...this.#definitions.values()]
      .filter((definition) => this.#available || !definition.requiresWorkspace)
      .filter((definition) => seeing || !definition.requiresVision)
      .filter((definition) => this.#shell || !definition.requiresShell)
      .map(({ spec }) => spec);
  }

  /** Whether the shell tool can run here, and why not when it can't. */
  shellAvailability(): ShellAvailability {
    return this.#shell ? { available: true } : shellUnavailable;
  }

  /** Re-detects the shell without restarting, updating what `list()` offers. */
  recheckShell(
    environment: NodeJS.ProcessEnv = process.env,
  ): ShellAvailability {
    this.#shell = resolveShell(environment);
    return this.shellAvailability();
  }

  /**
   * The boundary moves only once the new folder is known to be usable. A
   * change that fails is a change that did not happen: the tools keep the
   * folder the person is still being shown.
   */
  async selectWorkspace(path: string): Promise<void> {
    const target = await realpath(path);
    if (!(await stat(target)).isDirectory())
      throw new Error("Choose an existing folder.");
    this.#root = target;
    this.#available = true;
  }

  workspaceRoot(): string | undefined {
    return this.#available ? this.#root : undefined;
  }

  describeWorkspace(): Promise<WorkspaceDescription> {
    if (!this.#available)
      return Promise.resolve({
        rootName: "No folder selected",
        entries: [],
        truncated: false,
      });
    return describeWorkspaceRoot(this.#root);
  }

  async inspect(name: string, args: unknown): Promise<ToolCallInspection> {
    const definition = this.#definitions.get(name);
    if (definition?.requiresWorkspace && !this.#available)
      return { ok: false, reason: "Choose a folder before using files." };
    if (definition?.requiresShell && !this.#shell)
      return { ok: false, reason: `The tool “${name}” is not available.` };
    return definition
      ? definition.inspect(args)
      : { ok: false, reason: `The tool “${name}” is not available.` };
  }

  async execute(
    name: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    const definition = this.#definitions.get(name);
    if (definition?.requiresWorkspace && !this.#available)
      return { ok: false, reason: "Choose a folder before using files." };
    if (definition?.requiresShell && !this.#shell)
      return { ok: false, reason: `The tool “${name}” is not available.` };
    return definition
      ? definition.execute(args, signal)
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

export { CanvasPictureFitting } from "./fit-picture.js";
