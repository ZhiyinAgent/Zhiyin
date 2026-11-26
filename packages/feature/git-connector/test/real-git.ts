/**
 * The git installed on this computer, for the connector's tests that work on
 * real repositories, and git run apart from the connector to set one up or
 * read it back.
 */

import { describe } from "vitest";
import { resolveGit } from "../src/index.js";

export const git = resolveGit();
/** Tests that need a real git, skipped where none is installed. */
export function withGit(name: string, tests: () => void): void {
  (git ? describe : describe.skip)(name, tests);
}

/** Git's own variables that tie a command to one repository, as it lists them. */
const repositoryVariables = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
]);

/** The environment with none of them, so a check reads the folder it names. */
function ownEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !repositoryVariables.has(name.toUpperCase()),
    ),
  );
}

/** What git prints in a folder, read independently of the connector. */
export async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve, reject) =>
    execFile(
      git as string,
      args,
      { cwd, env: ownEnvironment() },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    ),
  );
}

export async function execGitInit(gitExe: string, cwd: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(gitExe, ["init", "--quiet"], {
      cwd,
      env: ownEnvironment(),
    });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`git init failed: ${code}`)),
    );
    child.on("error", reject);
  });
}
