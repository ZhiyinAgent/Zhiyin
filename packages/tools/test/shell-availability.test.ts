import { describe, expect, it } from "vitest";
import { WorkspaceTools, shellAvailability } from "../src/index.js";

const emptyEnvironment: NodeJS.ProcessEnv = { PATH: "" };

describe("shell availability", () => {
  it("is available when a real shell is found", () => {
    expect(
      shellAvailability({
        ...emptyEnvironment,
        ZHIYIN_BASH: process.execPath,
      }),
    ).toEqual({ available: true });
  });

  it("is unavailable, with a reason and an install link, when no shell is found", () => {
    const result = shellAvailability(emptyEnvironment);

    expect(result.available).toBe(false);
    if (result.available) throw new Error("unreachable");
    expect(result.reason).toMatch(/git for windows/i);
    expect(result.installUrl).toBe("https://git-scm.com/download/win");
  });
});

describe("WorkspaceTools shell availability", () => {
  it("reports unavailable and omits the bash tool when constructed without a shell", () => {
    const tools = new WorkspaceTools(".", { shell: undefined });

    expect(tools.list().map((tool) => tool.name)).not.toContain("bash");
    expect(tools.shellAvailability?.()).toMatchObject({ available: false });
  });

  it("picks up a shell found on recheck, without reconstruction", () => {
    const tools = new WorkspaceTools(".", { shell: undefined });

    const rechecked = tools.recheckShell?.({
      ...emptyEnvironment,
      ZHIYIN_BASH: process.execPath,
    });

    expect(rechecked).toEqual({ available: true });
    expect(tools.shellAvailability?.()).toEqual({ available: true });
    expect(tools.list().map((tool) => tool.name)).toContain("bash");
  });

  it("goes back to unavailable when a recheck finds nothing", () => {
    const tools = new WorkspaceTools(".", {
      shell: process.execPath,
    });

    const rechecked = tools.recheckShell?.(emptyEnvironment);

    expect(rechecked).toMatchObject({ available: false });
    expect(tools.list().map((tool) => tool.name)).not.toContain("bash");
  });
});
