/**
 * The folder each conversation works in (ADR 0008). Every other feature that
 * needs a conversation's folder asks here, through the contract's
 * `WorkspaceContext`; the tools ask here for the folder a call works in.
 */

import { basename, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import type {
  FolderInstructions,
  WorkspaceContext,
  WorkspaceDescription,
} from "@zhiyin/contract";
import { describeWorkspaceRoot } from "../files/reading/list-directory.js";
import { readFolderInstructions } from "./folder-instructions.js";
import type { Folder } from "../tool-definition.js";

async function existingFolder(path: string): Promise<string> {
  const target = await realpath(path);
  if (!(await stat(target)).isDirectory())
    throw new Error("Choose an existing folder.");
  return target;
}

/** Where a path resolves when no folder is open; never worked in. */
const noFolder = resolve(".");

export class ConversationFolders implements WorkspaceContext {
  /**
   * The folder a call works in when it names no conversation, or one that
   * entered no folder.
   */
  readonly #folder: string | undefined;
  /** Each conversation's folder, once it has entered one. */
  readonly #folders = new Map<string, string>();

  /**
   * `workspaceRoot` is the folder of a registry that serves one folder: the
   * one a call works in when it names no conversation, or names one that
   * entered none. The app gives none, and each conversation enters its own.
   */
  constructor(workspaceRoot?: string) {
    // An empty name is no folder: resolved, it would be wherever Zhiyin was
    // started.
    this.#folder = workspaceRoot ? resolve(workspaceRoot) : undefined;
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

  /** The folder a call of this conversation works in, or that it has none. */
  folderOf(conversationId: string | undefined): Folder {
    const root = this.workspaceRoot(conversationId);
    return root === undefined
      ? { root: noFolder, available: false }
      : { root, available: true };
  }

  /** The folder's AGENTS.md, when it has one. ADR 0016. */
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
}
