/**
 * Suspending a container's processes, against a stand-in for Windows' own
 * calls: every process in its job, those started while it is done included,
 * each resumed once; never a process outside the job that took an id one in
 * it had; and nothing left suspended when one cannot be.
 */

import { describe, expect, it } from "vitest";
import type { Win32 } from "../src/kernel32.js";
import { ProcessEnds } from "../src/process-ends.js";
import { containerOver } from "../src/windows.js";

/**
 * A job's processes as Windows reports them. `starts` names, by process, the
 * one it starts once while it is still running, before it is suspended.
 */
function windows(options: {
  readonly inJob: number[];
  readonly starts?: Readonly<Record<number, number>>;
  readonly outside?: readonly number[];
  readonly refusing?: readonly number[];
  /** Still listed in the job on every pass, while Windows ends them. */
  readonly ending?: readonly number[];
}) {
  const job = 7n;
  const listed = [...options.inJob];
  // The job's first list still names a process that has since ended, whose
  // id another process outside the job now has.
  let first = true;
  const suspended = new Map<number, number>();
  const open = new Map<number, number>();
  const api = {
    createJob: () => job,
    setLimits: () => true,
    closeHandle: (handle: { pid?: number }) => {
      if (handle.pid !== undefined)
        open.set(handle.pid, (open.get(handle.pid) ?? 0) - 1);
      return true;
    },
    jobProcessIds: () => {
      const ids = first ? [...listed, ...(options.outside ?? [])] : listed;
      first = false;
      return [...ids];
    },
    openToSuspend: (pid: number) => {
      open.set(pid, (open.get(pid) ?? 0) + 1);
      return { pid };
    },
    inJob: (handle: { pid: number }) => !options.outside?.includes(handle.pid),
    suspendProcess: (handle: { pid: number }) => {
      if (options.refusing?.includes(handle.pid)) return "refused";
      if (options.ending?.includes(handle.pid)) return "ending";
      const started = options.starts?.[handle.pid];
      if (started !== undefined && !listed.includes(started))
        listed.push(started);
      suspended.set(handle.pid, (suspended.get(handle.pid) ?? 0) + 1);
      return "suspended";
    },
    resumeProcess: (handle: { pid: number }) => {
      suspended.set(handle.pid, (suspended.get(handle.pid) ?? 0) - 1);
      return true;
    },
  } as unknown as Win32;
  return { api, suspended, open };
}

const container = (api: Win32) => containerOver(api, new ProcessEnds(api), {});

describe("a container's processes suspended", () => {
  it("are every process in its job, those started while it is done included, each resumed once", () => {
    const machine = windows({ inJob: [10, 11], starts: { 11: 12 } });

    const suspension = container(machine.api).suspend!();
    const held = Object.fromEntries(machine.suspended);
    suspension.resume();
    suspension.resume();

    expect(held).toEqual({ 10: 1, 11: 1, 12: 1 });
    expect(Object.fromEntries(machine.suspended)).toEqual({
      10: 0,
      11: 0,
      12: 0,
    });
  });

  it("never include a process outside the job that took the id of one that ended", () => {
    const machine = windows({ inJob: [10], outside: [20] });

    container(machine.api).suspend!().resume();

    expect([...machine.suspended.keys()]).toEqual([10]);
  });

  it("are all resumed, and the suspension refused, when one in the job cannot be suspended", () => {
    const machine = windows({ inJob: [10, 11], refusing: [11] });

    expect(() => container(machine.api).suspend!()).toThrow(
      "Process 11 in the job could not be suspended.",
    );
    expect(Object.fromEntries(machine.suspended)).toEqual({ 10: 0 });
  });

  it("pass over one Windows is ending, though the job still lists it, and leave no process open after", () => {
    const machine = windows({ inJob: [10, 11, 12], ending: [11] });

    const suspension = container(machine.api).suspend!();
    const held = Object.fromEntries(machine.suspended);
    suspension.resume();

    expect(held).toEqual({ 10: 1, 12: 1 });
    expect(Object.fromEntries(machine.suspended)).toEqual({ 10: 0, 12: 0 });
    expect(Object.fromEntries(machine.open)).toEqual({ 10: 0, 11: 0, 12: 0 });
  });
});
