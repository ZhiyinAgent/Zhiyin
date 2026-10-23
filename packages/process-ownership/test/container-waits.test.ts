/**
 * Zhiyin waits on at most 189 programs it started at once: past that, the
 * waits would take every thread its file work shares. Against a stand-in for
 * Windows' own calls, where no program ever ends, a container starts no
 * program past the most, and lets go of a program it cannot wait on.
 */

import { expect, it } from "vitest";
import { WAIT_TIMEOUT, type Win32 } from "../src/kernel32.js";
import { ProcessEnds, tooManyProcesses } from "../src/process-ends.js";
import { containerOver } from "../src/windows.js";

/** Windows' calls as far as starting a program and waiting on it go. */
function windows() {
  let next = 100n;
  const open = new Set<bigint>();
  const handle = () => {
    next += 1n;
    open.add(next);
    return next;
  };
  const programs: bigint[] = [];
  const api = {
    securityAttributesSize: 24,
    startupInfoSize: 112,
    createJob: handle,
    setLimits: () => true,
    assign: () => true,
    closeHandle: (each: unknown) => open.delete(each as bigint),
    createFile: handle,
    inheritOnly: () => ({ list: null, release: () => undefined }),
    createProcess: (...args: unknown[]) => {
      const information = args[7] as Record<string, unknown>;
      const program = handle();
      programs.push(program);
      information["hProcess"] = program;
      information["hThread"] = handle();
      information["dwProcessId"] = 1_000 + programs.length;
      return true;
    },
    resumeThread: () => 1,
    terminateProcess: () => true,
    ended: () => WAIT_TIMEOUT,
    createEvent: handle,
    setEvent: () => true,
    resetEvent: () => true,
    waitForAny: () => undefined,
  } as unknown as Win32;
  return {
    api,
    /** The handle of each program started, in order. */
    programs,
    /** Whether Zhiyin still holds this handle. */
    holds: (each: bigint) => open.has(each),
  };
}

const program = {
  executable: "C:\\Programs\\tool.exe",
  arguments: [],
  cwd: "C:\\Work",
  stdout: "C:\\Work\\stdout.txt",
  stderr: "C:\\Work\\stderr.txt",
};

it("starts no program past the most it waits on at once", () => {
  const machine = windows();
  const container = containerOver(
    machine.api,
    new ProcessEnds(machine.api),
    {},
  );
  for (let count = 0; count < 189; count++)
    void container.launch(program).wait();

  expect(() => container.launch(program)).toThrow(tooManyProcesses);
  expect(machine.programs).toHaveLength(189);
});

it("lets go of a program it cannot wait on, and says why", async () => {
  const machine = windows();
  const container = containerOver(
    machine.api,
    new ProcessEnds(machine.api),
    {},
  );
  const unwaited = container.launch(program);
  for (let count = 0; count < 189; count++)
    void container.launch(program).wait();

  await expect(unwaited.wait()).rejects.toThrow(tooManyProcesses);
  expect(machine.holds(machine.programs[0]!)).toBe(false);
  expect(machine.holds(machine.programs[1]!)).toBe(true);
});
