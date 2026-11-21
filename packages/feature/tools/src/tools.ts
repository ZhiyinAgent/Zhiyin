import type {
  CommandOutput,
  FolderInstructions,
  ListWorkspace,
  RunningCommand,
  ShellAvailability,
  ToolCallInspection,
  ToolSpec,
  UserInputResponse,
  WorkspaceContext,
  WorkspaceDescription,
} from "@zhiyin/contract";
import { readFileTool } from "./files/reading/read-file.js";
import { readFilesTool } from "./files/reading/read-files.js";
import { comparePicturesTool } from "./documents/compare-pictures.js";
import type { PixelComparer } from "@zhiyin/picture-comparison";
import type { PixelSource } from "./documents/picture-pixels.js";
import type { PdfPagesSource } from "./documents/read-pdf.js";
import { readDocumentTool } from "./documents/read-document.js";
import { closeDocumentTool } from "./documents/close-document.js";
import { listDirectoryTool } from "./files/reading/list-directory.js";
import { writeFileTool } from "./files/editing/write-file.js";
import { multiEditTool } from "./files/editing/multi-edit.js";
import { searchFilesTool } from "./files/search/search-files.js";
import { findFilesTool } from "./files/search/find-files.js";
import {
  bundledRipgrep,
  defaultCheckedUpTo,
  defaultFilesKept,
  listFiles,
  type ListingSetup,
  type RunProgram,
} from "@zhiyin/workspace-listing";
import { runProcess } from "@zhiyin/sandbox";
import {
  runCommandTool,
  type CommandContainment,
} from "./commands/run-command.js";
import {
  CommandShell,
  resolveShell,
  shellAvailability as probeShellAvailability,
} from "./commands/shell.js";
import { requestAccessTool } from "./commands/request-access.js";
import type { ConversationReach } from "./commands/reach.js";
import type { SealedShellSetup } from "./commands/sealed-shell.js";
import { renderDiagram } from "./views/render-diagram.js";
import { renderBarChart } from "./views/render-bar-chart.js";
import { renderLineChart } from "./views/render-line-chart.js";
import { renderScatterPlot } from "./views/render-scatter-plot.js";
import { renderHistogram } from "./views/render-histogram.js";
import { renderBoxPlot } from "./views/render-box-plot.js";
import { askUser, renderQuiz } from "./views/user-input.js";
import type { ConversationItems } from "./shared/conversation-items.js";
import type { RecycleBin } from "@zhiyin/files";
import { deleteFileTool } from "./files/deleting/delete-file.js";
import { moveFileTool } from "./files/moving/move-file.js";
import { CommandJobs, jobTools } from "./commands/command-jobs.js";
import { ConversationFolders } from "./folders/conversation-folders.js";
import {
  ToolTable,
  type ToolRegistry,
  type ToolResult,
} from "./tool-registry.js";
import type {
  CommandEnded,
  CommandsChanged,
  JobChanges,
  ShellCommands,
} from "./commands/shell-commands.js";

export type { ShellAvailability, ToolCallInspection, ToolSpec };
export { resolveShell, probeShellAvailability as shellAvailability };

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
   * a contained process (ADR 0019); without one it happens in this process.
   */
  readonly pdfPages?: PdfPagesSource | undefined;
  /**
   * Where a picture or a PDF page is drawn to pixels for comparing. The
   * application gives a contained process (ADR 0019); without one it happens
   * in this process.
   */
  readonly pixels?: PixelSource | undefined;
  /**
   * Where two pictures' pixels are compared. The application gives a thread
   * of its own, so the arithmetic never holds up the core; without one it
   * happens in this thread.
   */
  readonly comparer?: PixelComparer | undefined;
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
  /**
   * Zhiyin's own folders: its data and its program. A write outside the
   * workspace, which the person approves by its path, never reaches them,
   * since a write there could change Zhiyin's own records.
   */
  readonly protect?: readonly string[] | undefined;
  /**
   * Zhiyin's own shell, busybox-w32, and what its sealed-off commands use
   * (ADR 0029). With it, commands run sealed off where a container can hold
   * them, and `request_access` is offered; without it, every command runs in
   * the bash found here with full access.
   */
  readonly sealedShell?: SealedShellSetup | undefined;
  /** What each conversation granted its sealed-off commands, as the agent loop keeps it. */
  readonly reach?: ConversationReach | undefined;
  /** How long a command runs before it carries on as a job. Defaults to 30 s. */
  readonly promoteCommandsAfterMs?: number | undefined;
  /** The most files a folder may hold for what commands change to be checked. */
  readonly checkCommandsUpTo?: number | undefined;
  /** Files named on one command's action; the rest are counted. */
  readonly commandFilesKept?: number | undefined;
};

/**
 * The built-in tools as the application uses them: the folder each
 * conversation works in, the tools it is offered, and the jobs its commands
 * carry on as, each its own part and built here from one set of options.
 */
export class WorkspaceTools
  implements ToolRegistry, WorkspaceContext, ShellCommands
{
  readonly #folders: ConversationFolders;
  readonly #table: ToolTable;
  readonly #jobs = new CommandJobs();
  readonly #shell: CommandShell;
  /**
   * A folder's files as the checks of what commands change list them, for
   * whatever copies a folder before a script or command runs in it.
   */
  readonly listWorkspace: ListWorkspace;

  /**
   * `workspaceRoot` is the folder of a registry that serves one folder: the
   * one a call works in when it names no conversation, or names one that
   * entered none. The app gives none, and each conversation enters its own.
   */
  constructor(workspaceRoot?: string, options: WorkspaceToolsOptions = {}) {
    this.#folders = new ConversationFolders(workspaceRoot);
    const shell = new CommandShell({
      ...("shell" in options ? { given: { shell: options.shell } } : {}),
      uncontained: options.uncontained,
      sealed: options.sealedShell,
      containment: options.containment,
    });
    this.#shell = shell;
    const { items } = options;
    const protect = options.protect ?? [];
    const rg = "ripgrep" in options ? options.ripgrep : bundledRipgrep();
    // ripgrep runs as every program Zhiyin starts does, in the containment
    // commands are given.
    const { containment } = options;
    const run: RunProgram = (program) =>
      runProcess({ ...program, ...(containment ? { containment } : {}) });
    const search = rg ? { rg, run } : undefined;
    const files: ListingSetup = {
      search,
      upTo: options.checkCommandsUpTo ?? defaultCheckedUpTo,
      kept: options.commandFilesKept ?? defaultFilesKept,
    };
    this.listWorkspace = (root) => listFiles(files, root, { ignored: true });
    this.#table = new ToolTable(
      [
        listDirectoryTool(),
        readDocumentTool({
          acceptsImages: options.acceptsImages,
          pdfPages: options.pdfPages,
          items,
        }),
        comparePicturesTool({
          acceptsImages: options.acceptsImages,
          pixels: options.pixels,
          comparer: options.comparer,
          items,
        }),
        closeDocumentTool(),
        readFileTool(items),
        readFilesTool(items),
        ...(search ? [searchFilesTool(search), findFilesTool(search)] : []),
        writeFileTool(items, protect),
        multiEditTool(items, protect),
        deleteFileTool(options.recycleBin, protect),
        moveFileTool(items, protect),
        runCommandTool({
          shell,
          containment: options.containment,
          items,
          jobs: this.#jobs,
          files,
          promoteAfterMs: options.promoteCommandsAfterMs,
          reach: options.reach,
        }),
        requestAccessTool(protect),
        ...(options.containment ? jobTools(this.#jobs) : []),
        renderDiagram,
        renderBarChart,
        renderLineChart,
        renderScatterPlot,
        renderHistogram,
        renderBoxPlot,
        askUser,
        renderQuiz,
      ],
      this.#folders,
      shell,
    );
  }

  // The tools offered and run.

  list(conversationId?: string): readonly ToolSpec[] {
    return this.#table.list(conversationId);
  }

  inspect(
    name: string,
    args: unknown,
    conversationId?: string,
  ): Promise<ToolCallInspection> {
    return this.#table.inspect(name, args, conversationId);
  }

  execute(
    name: string,
    args: unknown,
    signal?: AbortSignal,
    conversationId?: string,
    answerTokens?: number,
  ): Promise<ToolResult> {
    return this.#table.execute(
      name,
      args,
      signal,
      conversationId,
      answerTokens,
    );
  }

  completeUserInput(
    name: string,
    args: unknown,
    response: UserInputResponse,
  ): Promise<ToolResult> {
    return this.#table.completeUserInput(name, args, response);
  }

  shellAvailability(): ShellAvailability {
    return this.#table.shellAvailability();
  }

  recheckShell(
    environment: NodeJS.ProcessEnv = process.env,
  ): ShellAvailability {
    return this.#table.recheckShell(environment);
  }

  // Each conversation's folder.

  enterFolder(conversationId: string, path: string): Promise<string> {
    return this.#folders.enterFolder(conversationId, path);
  }

  checkFolder(path: string): Promise<string> {
    return this.#folders.checkFolder(path);
  }

  leaveFolder(conversationId: string): void {
    this.#folders.leaveFolder(conversationId);
  }

  workspaceRoot(conversationId: string | undefined): string | undefined {
    return this.#folders.workspaceRoot(conversationId);
  }

  folderInstructions(
    conversationId: string | undefined,
  ): Promise<FolderInstructions | undefined> {
    return this.#folders.folderInstructions(conversationId);
  }

  describeWorkspace(
    conversationId: string | undefined,
  ): Promise<WorkspaceDescription> {
    return this.#folders.describeWorkspace(conversationId);
  }

  // The jobs commands carry on as.

  onCommandEnded(listener: CommandEnded): void {
    this.#jobs.onCommandEnded(listener);
  }

  onCommandsChanged(watcher: CommandsChanged): void {
    this.#jobs.onCommandsChanged(watcher);
  }

  onJobChanges(watcher: JobChanges): void {
    this.#jobs.onJobChanges(watcher);
  }

  runningCommands(conversationId: string): readonly RunningCommand[] {
    return this.#jobs.runningCommands(conversationId);
  }

  commandOutput(
    conversationId: string,
    jobId: string,
  ): Promise<CommandOutput | undefined> {
    return this.#jobs.commandOutput(conversationId, jobId);
  }

  stopCommandForPerson(conversationId: string, jobId: string): Promise<void> {
    return this.#jobs.stopCommandForPerson(conversationId, jobId);
  }

  stopCommands(conversationId: string): Promise<void> {
    return this.#jobs.stopCommands(conversationId);
  }

  async forgetConversation(conversationId: string): Promise<void> {
    await this.#jobs.forgetConversation(conversationId);
    await this.#shell.sealed?.forget(conversationId);
  }

  stopAllCommands(): Promise<void> {
    return this.#jobs.stopAllCommands();
  }
}
