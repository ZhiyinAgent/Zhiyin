import {
  runProcess,
  type ProcessContainment,
  type ProcessRun,
} from "@zhiyin/process-ownership";

export type GitContainment = ProcessContainment;
export type GitContainer = ReturnType<ProcessContainment["open"]>;
export type GitInvocation = Pick<ProcessRun, "exitCode" | "stdout" | "stderr">;

const timeoutMs = 30_000;

/** One argv-based git invocation — never a shell string, so no quoting risk. */
export async function runGit(
  git: string,
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
  containment?: GitContainment,
): Promise<GitInvocation> {
  const result = await runProcess({
    executable: git,
    arguments: args,
    cwd,
    timeoutMs,
    ...(signal ? { signal } : {}),
    ...(containment ? { containment } : {}),
    environment: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_EDITOR: "true",
      GIT_PAGER: "cat",
    },
  });
  if (result.failure === "containment")
    return {
      exitCode: null,
      stdout: "",
      stderr: "git could not be started, because it could not be contained.",
    };
  if (result.failure === "start")
    return {
      exitCode: null,
      stdout: "",
      stderr: "git could not be started.",
    };
  return result;
}
