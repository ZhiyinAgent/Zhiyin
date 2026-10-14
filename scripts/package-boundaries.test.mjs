import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import {
  contractLineLimit,
  layerOfPackage,
  sourceLineBackstop,
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

  /** What the length rule said about a file of this many lines of code. */
  async function lengthMessages(lines, filePath) {
    const source = Array.from(
      { length: lines },
      (_, index) => `export const line${index} = ${index};`,
    ).join("\n");
    const [result] = await eslint.lintText(source, { filePath });
    return (result?.messages ?? [])
      .filter((message) => message.ruleId === "zhiyin/max-lines")
      .map((message) => message.message);
  }

  it("accepts a source file up to the backstop", async () => {
    expect(
      await lengthMessages(sourceLineBackstop, "packages/core/src/long.ts"),
    ).toEqual([]);
  });

  it("asks for a review of responsibilities, not a split, past the backstop", async () => {
    const [message] = await lengthMessages(
      sourceLineBackstop + 1,
      "apps/desktop/src/renderer/ui/app/Long.tsx",
    );
    expect(message).toContain("Review what this file is responsible for");
    expect(message).toContain("Split it only where its responsibilities part");
    expect(message).toContain("raise this file's ceiling");
  });

  it("holds a contract file to the contract's own limit", async () => {
    expect(
      await lengthMessages(contractLineLimit, "packages/contract/src/long.ts"),
    ).toEqual([]);
    expect(
      await lengthMessages(
        contractLineLimit + 1,
        "packages/contract/src/long.ts",
      ),
    ).toHaveLength(1);
  });

  it("refuses to lint a package that has no declared layer", () => {
    expect(() => layerOfPackage("a-package-nobody-declared")).toThrow(
      "has no layer",
    );
  });
});

/** What the path rules said about one import inside the model client. */
async function pathRefusals(source, filePath) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "import-x/no-restricted-paths")
    .map((message) => message.message);
}

const modelClient = "packages/model-client/src";

describe("model providers", { timeout: 60_000 }, () => {
  it("keeps a provider from reaching the list of every provider", async () => {
    const found = await pathRefusals(
      'import { OpenRouterModelClient } from "../index.js"; void OpenRouterModelClient;',
      `${modelClient}/providers/openrouter/violation.ts`,
    );
    expect(includes(found, "never another provider")).toBe(true);
  });

  it("keeps one provider from reaching another", async () => {
    const found = await pathRefusals(
      'import { openRouter } from "../openrouter/provider.js"; void openRouter;',
      `${modelClient}/providers/deepseek/violation.ts`,
    );
    expect(includes(found, "never another provider")).toBe(true);
  });

  it("lets a provider use the wire formats and the shared client", async () => {
    expect(
      await pathRefusals(
        'import { sendChatCompletions } from "../../wires/chat-completions/send.js"; import { ModelClientError } from "../../failures.js"; void sendChatCompletions; void ModelClientError;',
        `${modelClient}/providers/openrouter/allowed.ts`,
      ),
    ).toEqual([]);
  });

  it("keeps the shared client from reaching into a provider", async () => {
    const found = await pathRefusals(
      'import { openRouter } from "./providers/openrouter/provider.js"; void openRouter;',
      `${modelClient}/violation.ts`,
    );
    expect(includes(found, "only through their list")).toBe(true);
  });

  it("lets the shared client reach providers through their list", async () => {
    expect(
      await pathRefusals(
        'import { OpenRouterModelClient } from "./providers/index.js"; void OpenRouterModelClient;',
        `${modelClient}/allowed.ts`,
      ),
    ).toEqual([]);
  });
});

const ui = "apps/desktop/src/renderer/ui";

describe("the window", { timeout: 60_000 }, () => {
  it("reaches the core through the bridge, never by importing a backend package", async () => {
    const found = await refusals(
      'import { FileSessions } from "@zhiyin/session"; void FileSessions;',
      `${ui}/app/violation.tsx`,
    );
    expect(includes(found, "through the preload bridge")).toBe(true);
  });

  it("has no Electron of its own", async () => {
    const found = await refusals(
      'import { shell } from "electron"; void shell;',
      `${ui}/app/violation.tsx`,
    );
    expect(includes(found, "no Node or Electron access")).toBe(true);
  });

  it("may use the contract", async () => {
    expect(
      await refusals(
        'import { RELEASES_URL } from "@zhiyin/contract"; void RELEASES_URL;',
        `${ui}/app/allowed.tsx`,
      ),
    ).toEqual([]);
  });

  it("never imports the main process", async () => {
    const found = await pathRefusals(
      'import { buildCore } from "../../../main/composition.js"; void buildCore;',
      `${ui}/app/violation.tsx`,
    );
    expect(includes(found, "never by importing the main process")).toBe(true);
  });

  it("keeps one module from importing another", async () => {
    const found = await pathRefusals(
      'import { ApprovalPrompt } from "../actions/index.js"; void ApprovalPrompt;',
      `${ui}/conversation/violation.tsx`,
    );
    expect(includes(found, "does not import another module")).toBe(true);
  });

  it("lets the app shell use a module through its entry point only", async () => {
    expect(
      await pathRefusals(
        'import { ApprovalPrompt } from "../actions/index.js"; void ApprovalPrompt;',
        `${ui}/app/allowed.tsx`,
      ),
    ).toEqual([]);
    const found = await pathRefusals(
      'import { ApprovalPrompt } from "../actions/ApprovalPrompt.js"; void ApprovalPrompt;',
      `${ui}/app/violation.tsx`,
    );
    expect(includes(found, "Use actions through its index.ts")).toBe(true);
  });

  it("keeps shared pieces from depending on a module", async () => {
    const found = await pathRefusals(
      'import { ApprovalPrompt } from "../actions/index.js"; void ApprovalPrompt;',
      `${ui}/shared/violation.tsx`,
    );
    expect(includes(found, "Shared presentation holds neutral pieces")).toBe(
      true,
    );
  });
});

describe("the drawing process", { timeout: 60_000 }, () => {
  const drawing = "apps/desktop/src/drawing/violation.ts";

  it("runs the document viewer's drawing service and no other package", async () => {
    const found = await refusals(
      'import { FileSessions } from "@zhiyin/session"; void FileSessions;',
      drawing,
    );
    expect(includes(found, "drawing service only")).toBe(true);
    expect(
      await refusals(
        'import { drawingService } from "@zhiyin/document-viewer"; void drawingService;',
        drawing,
      ),
    ).toEqual([]);
  });

  it("imports nothing from the main process, the bridge or the window", async () => {
    const found = await pathRefusals(
      'import { buildCore } from "../main/composition.js"; void buildCore;',
      drawing,
    );
    expect(includes(found, "imports nothing from the main process")).toBe(true);
  });
});

describe("inside a package", { timeout: 60_000 }, () => {
  it("keeps the entry point to re-exports", async () => {
    const found = await refusals(
      'export { FileRecovery } from "./recovery.js";\nexport const limit = 1;',
      "packages/recovery/src/index.ts",
    );
    expect(includes(found, "index.ts only re-exports")).toBe(true);
  });

  it("refuses two files that import each other", async () => {
    // The file on disk imports this one, so importing it back closes a loop.
    const [result] = await eslint.lintText(
      'import { FileRecovery } from "./recovery.js"; export const recovery = FileRecovery;',
      { filePath: "packages/recovery/src/exclusive-restore.ts" },
    );
    expect(
      (result?.messages ?? []).filter(
        (message) => message.ruleId === "import-x/no-cycle",
      ),
    ).toHaveLength(1);
  });
});
