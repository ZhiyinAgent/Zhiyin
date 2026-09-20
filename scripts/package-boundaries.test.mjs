import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import {
  OVERSIZED_ORCHESTRATION_FILES,
  OVERSIZED_PACKAGE_FILES,
  OVERSIZED_RENDERER_FILES,
  layerOfPackage,
  orchestrationLineLimit,
} from "../eslint.config.js";

const eslint = new ESLint();

/** What the package rules said about one import, written into one file. */
async function refusals(source, filePath) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter(
      (message) =>
        message.ruleId === "@typescript-eslint/no-restricted-imports" ||
        message.ruleId === "no-restricted-imports" ||
        message.ruleId === "no-restricted-syntax" ||
        message.ruleId === "import-x/no-relative-packages",
    )
    .map((message) => message.message);
}

const includes = (messages, text) =>
  messages.some((message) => message.includes(text));

// Runs the real linter over real source, which takes seconds on its own and
// longer under a loaded suite.
describe("package layers", { timeout: 60_000 }, () => {
  it("rejects a feature importing another feature, even for its types", async () => {
    const found = await refusals(
      'import type { McpServers } from "@zhiyin/mcp"; export type Servers = McpServers;',
      "packages/tools/src/violation.ts",
    );
    expect(includes(found, "Features are composed, never coupled")).toBe(true);
  });

  it("allows a feature to import the contract", async () => {
    expect(
      await refusals(
        'import type { ToolSpec } from "@zhiyin/contract"; export type Spec = ToolSpec;',
        "packages/tools/src/allowed.ts",
      ),
    ).toEqual([]);
  });

  it("rejects the contract importing anything from the workspace", async () => {
    const found = await refusals(
      'import type { ToolRegistry } from "@zhiyin/tools"; export type Registry = ToolRegistry;',
      "packages/contract/src/violation.ts",
    );
    expect(includes(found, "The contract is the shared vocabulary")).toBe(true);
  });

  it("rejects the agent loop importing a real implementation", async () => {
    const found = await refusals(
      'import { FileSessions } from "@zhiyin/session"; void FileSessions;',
      "packages/agent-loop/src/violation.ts",
    );
    expect(includes(found, "import its types only")).toBe(true);
  });

  it("allows the agent loop to import a feature's interface", async () => {
    expect(
      await refusals(
        'import type { Sessions } from "@zhiyin/session"; export type Store = Sessions;',
        "packages/agent-loop/src/allowed.ts",
      ),
    ).toEqual([]);
  });

  it("rejects the agent loop reaching a group's member around the group", async () => {
    const found = await refusals(
      'import type { ToolRegistry } from "@zhiyin/tools"; export type Registry = ToolRegistry;',
      "packages/agent-loop/src/violation.ts",
    );
    expect(
      includes(found, "@zhiyin/capabilities presents these features as one"),
    ).toBe(true);
  });

  it("rejects the core reaching a group's member around the group", async () => {
    const found = await refusals(
      'import type { McpServers } from "@zhiyin/mcp"; export type Servers = McpServers;',
      "packages/core/src/violation.ts",
    );
    expect(
      includes(found, "@zhiyin/capabilities presents these features as one"),
    ).toBe(true);
  });

  it("allows the core the browser a person watches, which its group does not answer for", async () => {
    expect(
      await refusals(
        'import type { ConversationBrowsers } from "@zhiyin/interactive-browser"; export type Browsers = ConversationBrowsers;',
        "packages/core/src/allowed.ts",
      ),
    ).toEqual([]);
  });

  it("rejects a real implementation of even a listed exception", async () => {
    const found = await refusals(
      'import { BrowserSessions } from "@zhiyin/interactive-browser"; void BrowserSessions;',
      "packages/core/src/violation.ts",
    );
    expect(includes(found, "import its types only")).toBe(true);
  });

  it("allows an agent loop test to use a real implementation", async () => {
    expect(
      await refusals(
        'import { WorkspaceTools } from "@zhiyin/tools"; void WorkspaceTools;',
        "packages/agent-loop/test/allowed.test.ts",
      ),
    ).toEqual([]);
  });

  it("rejects an implementation reached by a dynamic import", async () => {
    const found = await refusals(
      'export async function open() { const tools = await import("@zhiyin/tools"); return new tools.WorkspaceTools(); }',
      "packages/agent-loop/src/violation.ts",
    );
    expect(found).not.toEqual([]);
  });

  it("rejects another package's type named inline", async () => {
    const found = await refusals(
      'export type Servers = import("@zhiyin/mcp").McpServers;',
      "packages/tools/src/violation.ts",
    );
    expect(found).not.toEqual([]);
  });

  it("rejects a package required at runtime", async () => {
    const found = await refusals(
      'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nexport const tools = load("@zhiyin/tools");',
      "packages/agent-loop/src/violation.ts",
    );
    expect(found).not.toEqual([]);
  });

  it("allows the contract's type named inline, which every package may use", async () => {
    expect(
      await refusals(
        'export type Spec = import("@zhiyin/contract").ToolSpec;',
        "packages/tools/src/allowed.ts",
      ),
    ).toEqual([]);
  });

  it("rejects a relative import that climbs into a sibling package", async () => {
    const found = await refusals(
      'import { ManagedMcpServers } from "../../mcp/src/index.js"; void ManagedMcpServers;',
      "packages/tools/src/violation.ts",
    );
    expect(found).not.toEqual([]);
  });

  it("rejects a group importing a feature that is not one of its members", async () => {
    const found = await refusals(
      'import type { Sessions } from "@zhiyin/session"; export type Store = Sessions;',
      "packages/capabilities/src/violation.ts",
    );
    expect(includes(found, "A group joins its own members")).toBe(true);
  });

  it("rejects a group importing a member's implementation", async () => {
    const found = await refusals(
      'import { WorkspaceTools } from "@zhiyin/tools"; void WorkspaceTools;',
      "packages/capabilities/src/violation.ts",
    );
    expect(includes(found, "import its types only")).toBe(true);
  });

  it("allows a group to import a member's interface", async () => {
    expect(
      await refusals(
        'import type { ToolRegistry } from "@zhiyin/tools"; export type Registry = ToolRegistry;',
        "packages/capabilities/src/allowed.ts",
      ),
    ).toEqual([]);
  });

  it("rejects the main process importing anything that decides", async () => {
    const found = await refusals(
      'import { AgentLoop } from "@zhiyin/agent-loop"; void AgentLoop;',
      "apps/desktop/src/main/index.ts",
    );
    expect(includes(found, "carry messages only")).toBe(true);
  });

  it("lets the composition root construct the parts", async () => {
    expect(
      await refusals(
        'import { AgentLoop } from "@zhiyin/agent-loop"; void AgentLoop;',
        "apps/desktop/src/main/composition.ts",
      ),
    ).toEqual([]);
  });

  it("refuses a file in an orchestration layer that passes the size limit", async () => {
    const tooLong = Array.from(
      { length: orchestrationLineLimit + 1 },
      (_, index) => `export const line${index} = ${index};`,
    ).join("\n");
    const [result] = await eslint.lintText(tooLong, {
      filePath: "packages/core/src/violation.ts",
    });
    expect(
      (result?.messages ?? []).some(
        (message) => message.ruleId === "max-lines",
      ),
    ).toBe(true);
  });

  it("pins an oversized file to a bounded, currently-necessary ceiling", async () => {
    const entries = Object.entries(OVERSIZED_ORCHESTRATION_FILES);
    for (const [path, max] of entries) {
      // A pin only raises the ceiling; a file that no longer needs it should
      // have its entry removed rather than left as dead headroom.
      expect(max).toBeGreaterThan(orchestrationLineLimit);
      // Bounded, so a pin cannot quietly become "no limit at all."
      expect(max).toBeLessThanOrEqual(orchestrationLineLimit + 100);
      const [result] = await eslint.lintFiles([path]);
      expect(
        (result?.messages ?? []).some(
          (message) => message.ruleId === "max-lines",
        ),
      ).toBe(false);
    }
  });

  it("pins oversized package and renderer files at their current size with no growth headroom", async () => {
    const pinned = {
      ...OVERSIZED_PACKAGE_FILES,
      ...OVERSIZED_RENDERER_FILES,
    };
    for (const [path, max] of Object.entries(pinned)) {
      expect(max).toBeGreaterThan(orchestrationLineLimit);
      const [current] = await eslint.lintFiles([path]);
      expect(
        (current?.messages ?? []).some(
          (message) => message.ruleId === "max-lines",
        ),
      ).toBe(false);

      const source = await import("node:fs/promises").then((fs) =>
        fs.readFile(path, "utf8"),
      );
      const [grown] = await eslint.lintText(
        `${source}\nexport const ratchetGrowth = true;`,
        { filePath: path },
      );
      expect(
        (grown?.messages ?? []).some(
          (message) => message.ruleId === "max-lines",
        ),
      ).toBe(true);
    }
  });

  it("refuses to lint a package that has no declared layer", () => {
    expect(() => layerOfPackage("a-package-nobody-declared")).toThrow(
      "has no layer",
    );
  });
});
