import { mkdir, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  WorkspaceTools,
  resolveShell,
  shellAvailability,
} from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

const emptyEnvironment: NodeJS.ProcessEnv = { PATH: "" };

describe("the bash WSL puts on PATH", () => {
  it("is never taken for the shell: its commands would run in a Linux machine Zhiyin does not contain", async () => {
    const root = await folders.make("zhiyin-wsl-");
    const windows = join(root, "Windows");
    const local = join(root, "Local");
    const system = join(windows, "System32");
    const aliases = join(local, "Microsoft", "WindowsApps");
    const tools = join(root, "tools");
    try {
      for (const folder of [system, aliases, tools]) {
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, "bash.exe"), "");
      }
      const environment = {
        SystemRoot: windows,
        LOCALAPPDATA: local,
        PATH: [system, aliases].join(delimiter),
      };

      expect(shellAvailability(environment).available).toBe(false);
      expect(
        resolveShell({
          ...environment,
          PATH: [system, aliases, tools].join(delimiter),
        }),
      ).toBe(join(tools, "bash.exe"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

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

  it("stays off where commands cannot be contained, even when a recheck finds a shell", () => {
    const withheld =
      "Zhiyin cannot contain what a command starts on this computer, so it runs none. Access is denied.";
    const tools = new WorkspaceTools(".", {
      shell: process.execPath,
      uncontained: "Access is denied.",
    });
    expect(tools.list().map((tool) => tool.name)).not.toContain("bash");

    const rechecked = tools.recheckShell?.({
      ...emptyEnvironment,
      ZHIYIN_BASH: process.execPath,
    });

    expect(rechecked).toEqual({ available: false, reason: withheld });
    expect(tools.shellAvailability?.()).toEqual({
      available: false,
      reason: withheld,
    });
    expect(tools.list().map((tool) => tool.name)).not.toContain("bash");
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
