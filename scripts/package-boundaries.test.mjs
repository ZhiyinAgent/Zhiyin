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
      "packages/feature/tools/src/violation.ts",
    );
    expect(includes(found, "Features are composed, never coupled")).toBe(true);
  });

  it("allows a feature to import the contract", async () => {
    expect(
      await refusals(
        'import type { ToolSpec } from "@zhiyin/contract"; export type Spec = ToolSpec;',
        "packages/feature/tools/src/allowed.ts",
      ),
    ).toEqual([]);
  });

  it("rejects the contract importing anything from the workspace", async () => {
    const found = await refusals(
      'import type { ToolRegistry } from "@zhiyin/tools"; export type Registry = ToolRegistry;',
      "packages/contract/contract/src/violation.ts",
    );
    expect(includes(found, "The contract is the shared vocabulary")).toBe(true);
  });

  it("rejects the agent loop importing a real implementation", async () => {
    const found = await refusals(
      'import { FileSessions } from "@zhiyin/session"; void FileSessions;',
      "packages/loop/agent-loop/src/violation.ts",
    );
    expect(includes(found, "import its types only")).toBe(true);
  });

  it("allows the agent loop to import a feature's interface", async () => {
    expect(
      await refusals(
        'import type { Sessions } from "@zhiyin/session"; export type Store = Sessions;',
        "packages/loop/agent-loop/src/allowed.ts",
      ),
    ).toEqual([]);
  });

  it("rejects the agent loop reaching a group's member around the group", async () => {
    const found = await refusals(
      'import type { ToolRegistry } from "@zhiyin/tools"; export type Registry = ToolRegistry;',
      "packages/loop/agent-loop/src/violation.ts",
    );
    expect(
      includes(found, "@zhiyin/capabilities presents these features as one"),
    ).toBe(true);
  });

  it("rejects the core reaching a group's member around the group", async () => {
    const found = await refusals(
      'import type { McpServers } from "@zhiyin/mcp"; export type Servers = McpServers;',
      "packages/core/core/src/violation.ts",
    );
    expect(
      includes(found, "@zhiyin/capabilities presents these features as one"),
    ).toBe(true);
  });

  it("allows the core the browser a person watches, which its group does not answer for", async () => {
    expect(
      await refusals(
        'import type { ConversationBrowsers } from "@zhiyin/interactive-browser"; export type Browsers = ConversationBrowsers;',
        "packages/core/core/src/allowed.ts",
      ),
    ).toEqual([]);
  });

  it("rejects a real implementation of even a listed exception", async () => {
    const found = await refusals(
      'import { BrowserSessions } from "@zhiyin/interactive-browser"; void BrowserSessions;',
      "packages/core/core/src/violation.ts",
    );
    expect(includes(found, "import its types only")).toBe(true);
  });

  it("allows an agent loop test to use a real implementation", async () => {
    expect(
      await refusals(
        'import { WorkspaceTools } from "@zhiyin/tools"; void WorkspaceTools;',
        "packages/loop/agent-loop/test/allowed.test.ts",
      ),
    ).toEqual([]);
  });

  it("rejects an implementation reached by a dynamic import", async () => {
    const found = await refusals(
      'export async function open() { const tools = await import("@zhiyin/tools"); return new tools.WorkspaceTools(); }',
      "packages/loop/agent-loop/src/violation.ts",
    );
    expect(found).not.toEqual([]);
  });

  it("rejects another package's type named inline", async () => {
    const found = await refusals(
      'export type Servers = import("@zhiyin/mcp").McpServers;',
      "packages/feature/tools/src/violation.ts",
    );
    expect(found).not.toEqual([]);
  });

  it("rejects a package required at runtime", async () => {
    const found = await refusals(
      'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nexport const tools = load("@zhiyin/tools");',
      "packages/loop/agent-loop/src/violation.ts",
    );
    expect(found).not.toEqual([]);
  });

  it("allows the contract's type named inline, which every package may use", async () => {
    expect(
      await refusals(
        'export type Spec = import("@zhiyin/contract").ToolSpec;',
        "packages/feature/tools/src/allowed.ts",
      ),
    ).toEqual([]);
  });

  it("rejects a feature's test importing another feature", async () => {
    const found = await refusals(
      'import { ManagedMcpServers } from "@zhiyin/mcp"; void ManagedMcpServers;',
      "packages/feature/tools/test/violation.test.ts",
    );
    expect(includes(found, "Features are composed, never coupled")).toBe(true);
  });

  it("rejects a feature's test reaching another feature by a dynamic import", async () => {
    const found = await refusals(
      'export async function open() { return await import("@zhiyin/mcp"); }',
      "packages/feature/tools/system-boundary/violation.test.ts",
    );
    expect(includes(found, "with a static import")).toBe(true);
  });

  it("rejects another feature's type named inline in a feature's test", async () => {
    const found = await refusals(
      'export type Servers = import("@zhiyin/mcp").McpServers;',
      "packages/feature/model-client/src/providers/anthropic/test/violation.test.ts",
    );
    expect(includes(found, "through a top-level `import type`")).toBe(true);
  });

  it("rejects a feature's test requiring another feature at runtime", async () => {
    const found = await refusals(
      'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nexport const mcp = load("@zhiyin/mcp");',
      "packages/feature/tools/test/violation.test.ts",
    );
    expect(includes(found, "required at runtime")).toBe(true);
  });

  it("rejects the contract's test reaching a platform package by a dynamic import", async () => {
    const found = await refusals(
      'export async function open() { return await import("@zhiyin/sandbox"); }',
      "packages/contract/contract/test/violation.test.ts",
    );
    expect(includes(found, "with a static import")).toBe(true);
  });

  it("allows a feature's test its own package by a dynamic import", async () => {
    expect(
      await refusals(
        'export async function open() { return await import("@zhiyin/tools"); }',
        "packages/feature/tools/test/allowed.test.ts",
      ),
    ).toEqual([]);
  });

  it("allows a feature's test to stand in for a platform package", async () => {
    expect(
      await refusals(
        'import { vi } from "vitest";\nvi.mock("@zhiyin/sandbox", async (original) => ({ ...(await original<typeof import("@zhiyin/sandbox")>()) }));',
        "packages/feature/tools/test/allowed.test.ts",
      ),
    ).toEqual([]);
  });

  it("rejects a relative import that climbs into a sibling package", async () => {
    const found = await refusals(
      'import { ManagedMcpServers } from "../../mcp/src/index.js"; void ManagedMcpServers;',
      "packages/feature/tools/src/violation.ts",
    );
    expect(found).not.toEqual([]);
  });

  it("rejects a group importing a feature that is not one of its members", async () => {
    const found = await refusals(
      'import type { Sessions } from "@zhiyin/session"; export type Store = Sessions;',
      "packages/group/capabilities/src/violation.ts",
    );
    expect(includes(found, "A group joins its own members")).toBe(true);
  });

  it("rejects a group importing a member's implementation", async () => {
    const found = await refusals(
      'import { WorkspaceTools } from "@zhiyin/tools"; void WorkspaceTools;',
      "packages/group/capabilities/src/violation.ts",
    );
    expect(includes(found, "import its types only")).toBe(true);
  });

  it("allows a group to import a member's interface", async () => {
    expect(
      await refusals(
        'import type { ToolRegistry } from "@zhiyin/tools"; export type Registry = ToolRegistry;',
        "packages/group/capabilities/src/allowed.ts",
      ),
    ).toEqual([]);
  });

  it("rejects a group importing a member it serves through the contract", async () => {
    const found = await refusals(
      'import type { GitAutomationOptions } from "@zhiyin/git-connector"; export type Options = GitAutomationOptions;',
      "packages/group/capabilities/src/violation.ts",
    );
    expect(includes(found, "A group joins its own members")).toBe(true);
  });

  it("rejects the core reaching a member its group serves through the contract", async () => {
    const found = await refusals(
      'import type { GitAutomationOptions } from "@zhiyin/git-connector"; export type Options = GitAutomationOptions;',
      "packages/core/core/src/violation.ts",
    );
    expect(
      includes(found, "@zhiyin/capabilities presents these features as one"),
    ).toBe(true);
  });

  it.each(["tsx", "mts", "cts"])(
    "holds a .%s file to the layer rule",
    async (extension) => {
      const found = await refusals(
        'import type { McpServers } from "@zhiyin/mcp"; export type Servers = McpServers;',
        `packages/feature/tools/src/violation.${extension}`,
      );
      expect(includes(found, "Features are composed, never coupled")).toBe(
        true,
      );
    },
  );

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
      await lengthMessages(
        sourceLineBackstop,
        "packages/core/core/src/long.ts",
      ),
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
      await lengthMessages(
        contractLineLimit,
        "packages/contract/contract/src/long.ts",
      ),
    ).toEqual([]);
    expect(
      await lengthMessages(
        contractLineLimit + 1,
        "packages/contract/contract/src/long.ts",
      ),
    ).toHaveLength(1);
  });

  it("refuses to lint a package that has no declared layer", () => {
    expect(() => layerOfPackage("a-package-nobody-declared")).toThrow(
      "has no layer",
    );
  });
});

describe("test helpers", { timeout: 60_000 }, () => {
  const serveTestsOnly = "Test helpers serve tests only";

  it.each([
    [
      'import { TemporaryFolders } from "@zhiyin/test-support"; void TemporaryFolders;',
      "packages/feature/tools/src/violation.ts",
    ],
    [
      'import { until } from "@zhiyin/test-support"; void until;',
      "packages/platform/sandbox/src/violation.ts",
    ],
    [
      'import { holdOpen } from "@zhiyin/test-support"; void holdOpen;',
      "packages/core/core/src/violation.ts",
    ],
    [
      'import { TemporaryFolders } from "@zhiyin/test-support"; void TemporaryFolders;',
      "apps/desktop/src/main/composition.ts",
    ],
  ])("refuses %s in code the app runs, %s", async (source, filePath) => {
    expect(includes(await refusals(source, filePath), serveTestsOnly)).toBe(
      true,
    );
  });

  it.each([
    [
      'import { until } from "@zhiyin/test-support"; void until;',
      "packages/feature/tools/test/allowed.test.ts",
    ],
    [
      'import { TemporaryFolders } from "@zhiyin/test-support"; void TemporaryFolders;',
      "packages/feature/tools/test/support.ts",
    ],
    [
      'import { holdOpen } from "@zhiyin/test-support"; void holdOpen;',
      "packages/platform/sandbox/src/allowed.test.ts",
    ],
    [
      'import { until } from "@zhiyin/test-support"; void until;',
      "apps/desktop/src/main/composition.test.ts",
    ],
  ])("allows %s in a test or its support, %s", async (source, filePath) => {
    expect(await refusals(source, filePath)).toEqual([]);
  });

  it("keeps a test helper from importing anything but the contract", async () => {
    for (const source of [
      'import type { ToolRegistry } from "@zhiyin/tools"; export type Registry = ToolRegistry;',
      'import { diffLines } from "@zhiyin/text-diff"; void diffLines;',
    ])
      expect(
        includes(
          await refusals(
            source,
            "packages/test-helper/test-support/src/violation.ts",
          ),
          "A test helper serves tests only",
        ),
      ).toBe(true);
  });
});

describe("testing entries", { timeout: 60_000 }, () => {
  const forTestsOnly = "A testing entry holds a package's fakes, for tests";

  it.each([
    [
      'import { fakeTools } from "@zhiyin/tools/testing"; void fakeTools;',
      "packages/feature/tools/src/violation.ts",
    ],
    [
      'import type { fakeModel } from "@zhiyin/model-client/testing"; export type Fake = typeof fakeModel;',
      "packages/loop/agent-loop/src/violation.ts",
    ],
    [
      'import { stubDependencies } from "@zhiyin/agent-loop/testing"; void stubDependencies;',
      "packages/core/core/src/violation.ts",
    ],
    [
      'import { fakeSessions } from "@zhiyin/session/testing"; void fakeSessions;',
      "apps/desktop/src/main/composition.ts",
    ],
    [
      'import { fakeSessions } from "@zhiyin/session/testing"; void fakeSessions;',
      "apps/desktop/src/main/index.ts",
    ],
    [
      'import { fake } from "@zhiyin/text-diff/testing"; void fake;',
      "apps/desktop/src/renderer/ui/app/violation.tsx",
    ],
    [
      'import { fake } from "@zhiyin/document-viewer/testing"; void fake;',
      "apps/desktop/src/drawing/violation.ts",
    ],
  ])("refuses %s in code the app runs, %s", async (source, filePath) => {
    const found = await refusals(source, filePath);
    expect(includes(found, forTestsOnly)).toBe(true);
    expect(includes(found, "(ADR 0002)")).toBe(true);
  });

  it.each([
    [
      'import { fakeTools } from "@zhiyin/tools/testing"; void fakeTools;',
      "packages/feature/tools/test/allowed.test.ts",
    ],
    [
      'import { fakeMcp } from "@zhiyin/mcp/testing"; void fakeMcp;',
      "packages/group/capabilities/test/fakes.ts",
    ],
    [
      'import { fakeMembers } from "@zhiyin/capabilities/testing"; void fakeMembers;',
      "packages/loop/agent-loop/test/stubs.ts",
    ],
    [
      'import { stubDependencies } from "@zhiyin/agent-loop/testing"; void stubDependencies;',
      "packages/core/core/test/app/support.ts",
    ],
    [
      'import { fakeRecovery } from "@zhiyin/recovery/testing"; void fakeRecovery;',
      "packages/group/rewind/test/allowed.test.ts",
    ],
  ])(
    "allows %s in a test where the package may be imported, %s",
    async (source, filePath) => {
      expect(await refusals(source, filePath)).toEqual([]);
    },
  );

  it("keeps a feature's tests from another feature's fakes", async () => {
    const found = await refusals(
      'import { fakeMcp } from "@zhiyin/mcp/testing"; void fakeMcp;',
      "packages/feature/tools/test/violation.test.ts",
    );
    expect(includes(found, "Features are composed, never coupled")).toBe(true);
  });

  it("holds a feature's fakes to the feature's layer", async () => {
    const found = await refusals(
      'import type { Sessions } from "@zhiyin/session"; export type Store = Sessions;',
      "packages/feature/recovery/test/fakes.ts",
    );
    expect(includes(found, "Features are composed, never coupled")).toBe(true);
  });

  it("holds a group's fakes to its members", async () => {
    const found = await refusals(
      'import { fakeSessions } from "@zhiyin/session/testing"; void fakeSessions;',
      "packages/group/capabilities/test/fakes.ts",
    );
    expect(includes(found, "A group joins its own members")).toBe(true);
  });

  it("holds the loop's fakes to the layers below it", async () => {
    const found = await refusals(
      'import type { Workspace } from "@zhiyin/core"; export type App = Workspace;',
      "packages/loop/agent-loop/test/stubs.ts",
    );
    expect(includes(found, "The agent loop does not import the core")).toBe(
      true,
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

const modelClient = "packages/feature/model-client/src";

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

  it("may use a pure package", async () => {
    expect(
      await refusals(
        'import { diffLines } from "@zhiyin/text-diff"; void diffLines;',
        `${ui}/app/allowed.tsx`,
      ),
    ).toEqual([]);
  });
});

describe("pure packages", { timeout: 60_000 }, () => {
  it("are used by a feature, functions and all", async () => {
    expect(
      await refusals(
        'import { diffLines } from "@zhiyin/text-diff"; void diffLines;',
        "packages/feature/tools/src/allowed.ts",
      ),
    ).toEqual([]);
  });

  it("are used by the agent loop and the core as code, not only as types", async () => {
    for (const filePath of [
      "packages/loop/agent-loop/src/allowed.ts",
      "packages/core/core/src/allowed.ts",
    ])
      expect(
        await refusals(
          'import { withoutCredentials } from "@zhiyin/credential-removal"; void withoutCredentials;',
          filePath,
        ),
      ).toEqual([]);
  });

  it("are used by a platform package and a group", async () => {
    for (const filePath of [
      "packages/platform/files/src/allowed.ts",
      "packages/group/rewind/src/allowed.ts",
    ])
      expect(
        await refusals(
          'import { diffLines } from "@zhiyin/text-diff"; void diffLines;',
          filePath,
        ),
      ).toEqual([]);
  });

  it("use the contract and one another", async () => {
    expect(
      await refusals(
        'import type { DiffSummary } from "@zhiyin/contract";\nimport { withoutCredentials } from "@zhiyin/credential-removal";\nexport type Summary = DiffSummary; void withoutCredentials;',
        "packages/pure/text-diff/src/allowed.ts",
      ),
    ).toEqual([]);
  });

  it("reach no platform package, feature or orchestrator, even for its types", async () => {
    for (const other of ["files", "tools", "rewind", "core"]) {
      const found = await refusals(
        `import type { Anything } from "@zhiyin/${other}"; export type Some = Anything;`,
        "packages/pure/text-diff/src/violation.ts",
      );
      expect(includes(found, "A pure package computes"), other).toBe(true);
    }
  });

  it("are out of the contract's reach", async () => {
    const found = await refusals(
      'import { diffLines } from "@zhiyin/text-diff"; void diffLines;',
      "packages/contract/contract/src/violation.ts",
    );
    expect(includes(found, "The contract is the shared vocabulary")).toBe(true);
  });

  it("are held, in their tests too, to the packages they may use", async () => {
    const found = await refusals(
      'export async function open() { return await import("@zhiyin/tools"); }',
      "packages/pure/text-diff/test/violation.test.ts",
    );
    expect(includes(found, "with a static import")).toBe(true);
  });
});

describe(
  "the contract and pure packages run anywhere",
  { timeout: 60_000 },
  () => {
    const places = [
      "packages/contract/contract/src/violation.ts",
      "packages/pure/text-diff/src/violation.ts",
    ];

    it("import none of Node's modules, by either name", async () => {
      for (const filePath of places)
        for (const module of ["node:fs/promises", "fs", "path"]) {
          const found = await refusals(
            `import { join } from "${module}"; void join;`,
            filePath,
          );
          expect(includes(found, "runs wherever it is imported"), module).toBe(
            true,
          );
        }
    });

    it("import no npm package, even for its types", async () => {
      for (const filePath of places) {
        const found = await refusals(
          'import type { Root } from "mdast"; export type Tree = Root;',
          filePath,
        );
        expect(includes(found, "runs wherever it is imported")).toBe(true);
      }
    });

    it("reach none by a dynamic import, an inline type or a require either", async () => {
      for (const filePath of places)
        for (const source of [
          'export const read = () => import("node:fs");',
          'export type Stats = import("node:fs").Stats;',
          'export const load = () => require("lodash");',
        ]) {
          const found = await refusals(source, filePath);
          expect(includes(found, "runs wherever it is imported"), source).toBe(
            true,
          );
        }
    });

    it("still let their tests use the test runner and Node", async () => {
      expect(
        await refusals(
          'import { readFile } from "node:fs/promises";\nimport { it } from "vitest";\nvoid readFile; void it;',
          "packages/pure/text-diff/test/allowed.test.ts",
        ),
      ).toEqual([]);
    });
  },
);

describe("the contract's source", { timeout: 60_000 }, () => {
  const contractFile = "packages/contract/contract/src/violation.ts";
  const declarationsOnly = "The contract holds declarations only";

  it.each([
    [
      "a function",
      "export function size(text: string) { return text.length; }",
    ],
    ["an arrow function", "export const size = (text: string) => text.length;"],
    [
      "a function expression",
      "export const size = function (text: string) { return text.length; };",
    ],
    [
      "a method",
      "export class Sizes { size(text: string) { return text.length; } }",
    ],
    [
      "a method of an object",
      "export const sizes = { size(text: string) { return text.length; } };",
    ],
  ])("refuses %s", async (_, source) => {
    expect(
      includes(await refusals(source, contractFile), declarationsOnly),
    ).toBe(true);
  });

  it("keeps types and constants that are data", async () => {
    expect(
      await refusals(
        [
          'export type Look = "ink" | "dots";',
          "export type Check = (value: unknown) => boolean;",
          "export interface Sizes { size(text: string): number; }",
          'export const looks: readonly Look[] = ["ink", "dots"];',
          "export const limits = { rounds: [5, 1_000] } as const;",
          'export const channels = { ...{ open: "zhiyin:open" }, close: "zhiyin:close" } as const;',
        ].join("\n"),
        contractFile,
      ),
    ).toEqual([]);
  });

  it("does not hold a pure package or the contract's tests to it", async () => {
    const arrow = "export const size = (text: string) => text.length;";
    for (const filePath of [
      "packages/pure/text-diff/src/allowed.ts",
      "packages/contract/contract/test/allowed.test.ts",
    ])
      expect(includes(await refusals(arrow, filePath), declarationsOnly)).toBe(
        false,
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
      "packages/feature/recovery/src/index.ts",
    );
    expect(includes(found, "index.ts only re-exports")).toBe(true);
  });

  it("refuses two files that import each other", async () => {
    // The file on disk imports this one, so importing it back closes a loop.
    const [result] = await eslint.lintText(
      'import { FileRecovery } from "./recovery.js"; export const recovery = FileRecovery;',
      { filePath: "packages/feature/recovery/src/exclusive-restore.ts" },
    );
    expect(
      (result?.messages ?? []).filter(
        (message) => message.ruleId === "import-x/no-cycle",
      ),
    ).toHaveLength(1);
  });
});

describe("a test's temporary folders", { timeout: 60_000 }, () => {
  it.each([
    [
      'import { mkdtemp } from "node:fs/promises"; void mkdtemp;',
      "packages/feature/tools/system-boundary/violation.test.ts",
    ],
    [
      'import { mkdtempSync } from "node:fs"; void mkdtempSync;',
      "packages/feature/model-client/test/live-violation.ts",
    ],
    [
      'import { mkdtemp } from "fs/promises"; void mkdtemp;',
      "apps/desktop/installed/violation.ts",
    ],
    [
      'import { mkdtemp } from "node:fs/promises"; void mkdtemp;',
      "scripts/violation.test.mjs",
    ],
    [
      'import { mkdtemp } from "node:fs/promises"; void mkdtemp;',
      "apps/desktop/src/renderer/ui/shared/violation.test.tsx",
    ],
    [
      'import { mkdtemp } from "node:fs/promises"; void mkdtemp;',
      "apps/desktop/src/drawing/violation.test.ts",
    ],
    [
      'import { mkdtemp } from "node:fs/promises"; void mkdtemp;',
      "apps/desktop/src/main/test/violation.ts",
    ],
    [
      'import * as files from "node:fs/promises"; void files;',
      "packages/feature/tools/test/violation.test.ts",
    ],
    [
      'import files from "node:fs"; void files;',
      "packages/feature/tools/test/violation.test.ts",
    ],
    [
      'import { promises } from "node:fs"; void promises;',
      "packages/feature/tools/test/violation.test.ts",
    ],
  ])("refuses %s in %s", async (source, filePath) => {
    expect(includes(await refusals(source, filePath), "TemporaryFolders")).toBe(
      true,
    );
  });

  it("still refuses another package's files there", async () => {
    const found = await refusals(
      'import { x } from "@zhiyin/tools/src/internal.js"; void x;',
      "packages/feature/tools/system-boundary/violation.test.ts",
    );
    expect(includes(found, "Import a package by its name only")).toBe(true);
  });

  it("allows TemporaryFolders, and mkdtemp outside tests", async () => {
    expect(
      await refusals(
        'import { TemporaryFolders } from "@zhiyin/test-support"; void TemporaryFolders;',
        "packages/feature/tools/system-boundary/allowed.test.ts",
      ),
    ).toEqual([]);
    expect(
      await refusals(
        'import { mkdtemp } from "node:fs/promises"; void mkdtemp;',
        "packages/feature/tools/src/allowed.ts",
      ),
    ).toEqual([]);
  });
});
