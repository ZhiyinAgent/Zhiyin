/**
 * The sealed-off shell (ADR 0029): Zhiyin's busybox-w32, run in an app
 * container of the conversation's own, which reads the workspace, Zhiyin's
 * shell and toolchains, what Windows keeps open to every container and the
 * folders granted for reading; changes the workspace and the folders granted
 * for changing; keeps a home of its own where its tools' caches and settings
 * go; and reaches only the hosts on the conversation's list, through
 * Zhiyin's proxy. Its `git` hands each git command to Zhiyin.
 *
 * Whether it can be used is checked once, by starting it in a container: a
 * Windows that lacks what a container needs, or a shell that fails there,
 * leaves only commands with full access, each asked for.
 */

import { rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  forgetConfinement,
  holdingContainer,
  runProcess,
  windowsEnvironment,
  type Confinement,
  type PipeOpening,
  type ProcessContainment,
} from "@zhiyin/sandbox";
import { gitOpening, type GitTally, type ShellGit } from "./git-handoff.js";
import { packageRegistries, type ShellReach } from "./reach.js";

/** Zhiyin's shell, as the application hands it in. */
export type SealedShellSetup = {
  /** Zhiyin's busybox-w32. */
  readonly busybox: string;
  /** The folder holding the `git` that hands git commands to Zhiyin. */
  readonly handoff: string;
  /** Where each conversation's home is kept. */
  readonly homes: string;
  /** Zhiyin's toolchains, which commands may read and run. */
  readonly reads?: readonly string[];
  /** Runs git for the shell outside its container; absent, `git` says so. */
  readonly git?: ShellGit;
  /**
   * Zhiyin's own Node, a toolchain (ADR 0027), installed when a sealed-off
   * command first runs: its folder, holding `node.exe`, `npm` and `npx`, goes
   * first on the shell's `PATH`.
   */
  readonly node?: SealedToolchain;
};

/** A toolchain the shell installs on first use and runs from where it is. */
export type SealedToolchain = {
  /** The installed executable, or nothing before it is installed. */
  readonly executable: () => Promise<string | undefined>;
  /** Installs it, rejecting with why when it cannot. */
  readonly install: () => Promise<void>;
};

/** Whether commands can be sealed off here, and why not. */
export type SealedUse =
  { readonly sealed: true } | { readonly sealed: false; readonly why: string };

/** The container purpose every sealed-off command shares, a home apart. */
const purpose = "shell";

/** How a sealed-off command starts, and what its git reached. */
export type SealedRun = {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly environment: Record<string, string | undefined>;
  readonly confinement: Confinement;
  readonly openings: readonly PipeOpening[];
  readonly tally: GitTally;
  /** What the model is told of how the shell was set up, such as a Node that could not be had. */
  readonly notes: readonly string[];
};

export class SealedShell {
  readonly #setup: SealedShellSetup;
  readonly #containment: ProcessContainment | undefined;
  #checked: Promise<SealedUse> | undefined;
  #known: SealedUse;
  #installing: Promise<void> | undefined;

  constructor(
    setup: SealedShellSetup,
    containment: ProcessContainment | undefined,
  ) {
    this.#setup = setup;
    this.#containment = containment;
    this.#known = containment
      ? { sealed: true }
      : {
          sealed: false,
          why: "Zhiyin cannot contain commands on this computer, so none can be sealed off.",
        };
  }

  /** Zhiyin's busybox, which a command with full access runs too. */
  get busybox(): string {
    return this.#setup.busybox;
  }

  /** What is known now, before or after the start check. */
  known(): SealedUse {
    return this.#known;
  }

  /**
   * Starts the shell once in a container, writing to the null device, and
   * answers whether commands can be sealed off here.
   */
  check(): Promise<SealedUse> {
    if (!this.#containment) return Promise.resolve(this.#known);
    this.#checked ??= (async () => {
      const ran = await runProcess({
        executable: this.#setup.busybox,
        arguments: ["sh", "-c", "echo ready > /dev/null && echo ready"],
        cwd: dirname(this.#setup.busybox),
        timeoutMs: 60_000,
        containment: this.#containment!,
        environment: windowsEnvironment(),
        confinement: {
          purpose,
          home: join(this.#setup.homes, "start-check"),
          read: [dirname(this.#setup.busybox)],
          write: [],
          hosts: [],
        },
      });
      this.#known =
        ran.exitCode === 0 && ran.stdout.trim() === "ready"
          ? { sealed: true }
          : {
              sealed: false,
              why: `Zhiyin's shell did not start sealed off on this computer${ran.reason ? `: ${ran.reason}` : ran.stderr.trim() ? `: ${ran.stderr.trim().slice(0, 300)}` : "."}`,
            };
      return this.#known;
    })();
    return this.#checked;
  }

  /** The conversation's home, which its commands share and no other conversation reaches. */
  home(conversationId: string): string {
    return join(this.#setup.homes, conversationId.replace(/[^\w-]/g, "_"));
  }

  /** The hosts a command reaches, by what the conversation was granted. */
  hosts(reach: ShellReach): readonly string[] {
    return [
      ...new Set([
        ...reach.hosts,
        ...(reach.registries ? packageRegistries : []),
      ]),
    ];
  }

  /**
   * Zhiyin's Node's folder, installed first when it is not there: one install
   * for every command waiting on it, which a stopped command stops waiting
   * for. An install that fails is tried again by the next command.
   */
  async #node(
    signal: AbortSignal,
  ): Promise<
    { readonly folder: string } | { readonly why: string } | undefined
  > {
    const toolchain = this.#setup.node;
    if (!toolchain) return undefined;
    const found = async () => {
      const executable = await toolchain.executable();
      if (executable) return { folder: dirname(executable) };
      this.#installing ??= toolchain.install().finally(() => {
        this.#installing = undefined;
      });
      await this.#installing;
      const installed = await toolchain.executable();
      return installed
        ? { folder: dirname(installed) }
        : { why: "it was installed but its node.exe is not there." };
    };
    const stopped = new Promise<undefined>((resolve) => {
      if (signal.aborted) resolve(undefined);
      signal.addEventListener("abort", () => resolve(undefined), {
        once: true,
      });
    });
    return Promise.race([
      found().catch((error: unknown) => ({
        why: error instanceof Error ? error.message : String(error),
      })),
      stopped,
    ]);
  }

  /**
   * Removes a conversation's home, with the container Windows keeps for it,
   * once the conversation is gone. A home that is not there is nothing to do.
   */
  async forget(conversationId: string): Promise<void> {
    const home = this.home(conversationId);
    forgetConfinement(purpose, home);
    await rm(home, { recursive: true, force: true, maxRetries: 5 });
  }

  /** How `command` starts sealed off in `root` for the conversation. */
  async run(
    command: string,
    root: string,
    conversationId: string,
    reach: ShellReach,
    signal: AbortSignal,
    environment: Record<string, string | undefined>,
  ): Promise<SealedRun> {
    const home = this.home(conversationId);
    const shell = dirname(this.#setup.busybox);
    const hosts = this.hosts(reach);
    const tally: GitTally = { refusedHosts: new Set(), received: false };
    const node = await this.#node(signal);
    const nodeFolder = node && "folder" in node ? node.folder : undefined;
    const notes =
      node && "why" in node
        ? [
            `Zhiyin's own Node could not be installed, so node, npm and npx are whichever a container can reach here, if any: ${node.why}`,
          ]
        : [];
    const local = join(home, "AppData", "Local");
    const given = windowsEnvironment(environment);
    const path = Object.entries(given).find(
      ([name]) => name.toUpperCase() === "PATH",
    );
    const withoutPath = Object.fromEntries(
      Object.entries(given).filter(([name]) => name.toUpperCase() !== "PATH"),
    );
    return {
      executable: this.#setup.busybox,
      arguments: ["sh", "-c", command],
      environment: {
        ...withoutPath,
        // Zhiyin's Node and git first, then the shell's own tools, then the
        // person's programs, which a container reads where Windows lets
        // every one.
        PATH: [nodeFolder, this.#setup.handoff, shell, path?.[1] ?? ""]
          .filter(Boolean)
          .join(";"),
        HOME: home,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        // Node resolves each path to its real one, which Windows refuses a
        // container for the folders above those it was given.
        NODE_OPTIONS: "--preserve-symlinks --preserve-symlinks-main",
        npm_config_cache: join(local, "npm-cache"),
        PIP_CACHE_DIR: join(local, "pip", "Cache"),
        CARGO_HOME: join(home, ".cargo"),
      },
      confinement: {
        purpose,
        home,
        read: [
          shell,
          this.#setup.handoff,
          ...(nodeFolder ? [nodeFolder] : []),
          ...(this.#setup.reads ?? []),
          ...reach.read,
        ],
        write: [root, ...reach.change],
        hosts,
      },
      openings: this.#setup.git
        ? [
            gitOpening({
              git: this.#setup.git,
              folders: [root, ...reach.change],
              hosts,
              home,
              signal,
              tally,
              hold: (work) => holdingContainer(purpose, home, work),
            }),
          ]
        : [],
      tally,
      notes,
    };
  }
}
