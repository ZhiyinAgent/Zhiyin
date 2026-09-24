import { describe, expect, it } from "vitest";
import { CHANNEL } from "@zhiyin/contract";
import { validateCommand } from "../src/validation.js";

describe("privileged commands", () => {
  it("accepts bounded reasoning choices and rejects malformed message options", () => {
    for (const choice of [
      { enabled: false },
      { enabled: true, effort: "max" },
      { enabled: true },
    ])
      expect(() =>
        validateCommand(CHANNEL.sendMessage, ["task", "Hello", choice]),
      ).not.toThrow();
    for (const choice of [
      null,
      { enabled: "yes" },
      { enabled: true, effort: "extreme" },
      { enabled: false, effort: "high" },
      { enabled: true, extra: "unexpected" },
    ])
      expect(() =>
        validateCommand(CHANNEL.sendMessage, ["task", "Hello", choice]),
      ).toThrow();
  });
  it("accepts an optional argument that was left undefined", () => {
    expect(() =>
      validateCommand(CHANNEL.sendMessage, ["task", "Hello", undefined]),
    ).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.createTask, [undefined]),
    ).not.toThrow();
    // A gap in the middle is not an argument left out.
    expect(() =>
      validateCommand(CHANNEL.sendMessage, ["task", undefined, "Hello"]),
    ).toThrow();
  });

  it("rejects malformed approvals and unknown channels", () => {
    for (const args of [
      ["task", "call", "always"],
      ["task", "call", {}],
      ["task", "call", "allow", true],
    ]) {
      expect(() => validateCommand(CHANNEL.resolveApproval, args)).toThrow();
    }
    expect(() => validateCommand("unknown", [])).toThrow();
    expect(() =>
      validateCommand(CHANNEL.resolveApproval, ["task", "call", "allow"]),
    ).not.toThrow();
  });
  it("bounds structured answers crossing from the renderer", () => {
    expect(() =>
      validateCommand(CHANNEL.resolveUserInput, [
        "task",
        "input",
        { answers: [{ questionId: "audience", answerIds: ["team"] }] },
      ]),
    ).not.toThrow();
    for (const response of [
      { answers: "team" },
      { answers: [{ questionId: "audience", answerIds: [{}] }] },
      {
        answers: Array.from({ length: 13 }, (_, index) => ({
          questionId: `${index}`,
          text: "x",
        })),
      },
      { answers: [{ questionId: "audience", text: "x".repeat(4_001) }] },
    ]) {
      expect(() =>
        validateCommand(CHANNEL.resolveUserInput, ["task", "input", response]),
      ).toThrow();
    }
  });
  it("rejects oversized input and invalid capability payloads", () => {
    expect(() =>
      validateCommand(CHANNEL.sendMessage, ["task", "x".repeat(100_001)]),
    ).toThrow();
    expect(() =>
      validateCommand(CHANNEL.setComponentEnabled, ["research/x", "yes"]),
    ).toThrow();
  });
  it("accepts a message that is only pastes, but never an empty one", () => {
    const paste = "pasted-2026-09-24-101500.txt";
    expect(() =>
      validateCommand(CHANNEL.sendMessage, ["task", "", undefined, [paste]]),
    ).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.sendMessage, [
        "task",
        "Read",
        undefined,
        [paste],
      ]),
    ).not.toThrow();
    for (const args of [
      ["task", ""],
      ["task", "", undefined, []],
      ["task", "Read", undefined, [42]],
      ["task", "Read", undefined, "pasted.txt"],
      ["task", "Read", undefined, Array(21).fill(paste)],
    ])
      expect(() => validateCommand(CHANNEL.sendMessage, args)).toThrow();
  });
  it("takes a paste up to 50 MB to keep, and opens one only by its name", () => {
    expect(() =>
      validateCommand(CHANNEL.keepPaste, ["x".repeat(20_000)]),
    ).not.toThrow();
    expect(() => validateCommand(CHANNEL.keepPaste, [""])).toThrow();
    expect(() =>
      validateCommand(CHANNEL.keepPaste, ["x".repeat(50 * 1024 * 1024 + 1)]),
    ).toThrow();
    expect(() =>
      validateCommand(CHANNEL.openAttachment, [null, "pasted-1.txt"]),
    ).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.openAttachment, ["task", "pasted-1.txt"]),
    ).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.openAttachment, ["task", undefined]),
    ).toThrow();
  });
  it("accepts a model choice with a bounded list of upstreams", () => {
    expect(() =>
      validateCommand(CHANNEL.selectModel, ["z-ai/glm-5.3-flash", []]),
    ).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.selectModel, [
        "z-ai/glm-5.3-flash",
        ["deepinfra/fp4", "crusoe/fp4"],
      ]),
    ).not.toThrow();
    for (const args of [
      [],
      ["z-ai/glm-5.3-flash"],
      ["", []],
      ["z-ai/glm-5.3-flash", "deepinfra/fp4"],
      ["z-ai/glm-5.3-flash", [""]],
      ["z-ai/glm-5.3-flash", [42]],
      // A renderer cannot ask for an unbounded routing list, or an unbounded
      // name inside one: both would travel into a provider request.
      ["z-ai/glm-5.3-flash", Array.from({ length: 65 }, () => "a")],
      ["z-ai/glm-5.3-flash", ["a".repeat(201)]],
      ["a".repeat(201), []],
    ]) {
      expect(() => validateCommand(CHANNEL.selectModel, args)).toThrow();
    }
  });

  it("accepts one model name when asking who serves it", () => {
    expect(() =>
      validateCommand(CHANNEL.listModelProviders, ["z-ai/glm-5.3-flash"]),
    ).not.toThrow();
    expect(() => validateCommand(CHANNEL.listModels, [])).not.toThrow();
    for (const args of [[], [""], ["a", "b"], ["a".repeat(201)]]) {
      expect(() => validateCommand(CHANNEL.listModelProviders, args)).toThrow();
    }
    expect(() => validateCommand(CHANNEL.listModels, ["extra"])).toThrow();
  });

  it("accepts leaving every conversation, with nothing attached", () => {
    expect(() => validateCommand(CHANNEL.selectNothing, [])).not.toThrow();
    expect(() => validateCommand(CHANNEL.selectNothing, ["task-1"])).toThrow();
  });

  it("accepts checking shell availability, with nothing attached", () => {
    expect(() => validateCommand(CHANNEL.shellAvailability, [])).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.shellAvailability, ["extra"]),
    ).toThrow();
    expect(() => validateCommand(CHANNEL.recheckShell, [])).not.toThrow();
    expect(() => validateCommand(CHANNEL.recheckShell, ["extra"])).toThrow();
  });

  it("accepts refreshing connections, with nothing attached", () => {
    expect(() => validateCommand(CHANNEL.refreshConnections, [])).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.refreshConnections, ["extra"]),
    ).toThrow();
  });

  it("only opens a URL from the known allowlist", () => {
    expect(() =>
      validateCommand(CHANNEL.openExternalUrl, [
        "https://git-scm.com/download/win",
      ]),
    ).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.openExternalUrl, ["https://example.com/evil"]),
    ).toThrow();
    expect(() => validateCommand(CHANNEL.openExternalUrl, [])).toThrow();
  });

  it("accepts one folder path for a return to a known folder", () => {
    expect(() =>
      validateCommand(CHANNEL.useRecentWorkspace, ["C:/work/notes"]),
    ).not.toThrow();
    for (const args of [[], [""], [42], ["C:/a", "C:/b"]]) {
      expect(() => validateCommand(CHANNEL.useRecentWorkspace, args)).toThrow();
    }
  });

  it("accepts only exact rewind identities", () => {
    expect(() =>
      validateCommand(CHANNEL.previewRewind, ["task-1", "message-2"]),
    ).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.commitRewind, ["task-1", "rewind-3", "restore"]),
    ).not.toThrow();
    expect(() => validateCommand(CHANNEL.previewRewind, ["task-1"])).toThrow();
    expect(() =>
      validateCommand(CHANNEL.commitRewind, ["task-1", "", true]),
    ).toThrow();
  });

  it("accepts one MCP access token for one named server", () => {
    expect(() =>
      validateCommand(CHANNEL.saveMcpServerToken, ["search", "tvly-secret"]),
    ).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.clearMcpServerToken, ["search"]),
    ).not.toThrow();
    for (const args of [
      [],
      ["search"],
      ["search", ""],
      ["search", "x".repeat(4097)],
      ["", "tvly-secret"],
      ["search", "tvly-secret", true],
    ]) {
      expect(() => validateCommand(CHANNEL.saveMcpServerToken, args)).toThrow();
    }
    expect(() =>
      validateCommand(CHANNEL.clearMcpServerToken, ["search", "extra"]),
    ).toThrow();
  });
  it("accepts a plugin's on/off, install, update, rollback, and removal commands", () => {
    expect(() =>
      validateCommand(CHANNEL.setPluginEnabled, [
        "software-engineering",
        false,
      ]),
    ).not.toThrow();
    expect(() => validateCommand(CHANNEL.installPlugin, [])).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.updatePlugin, ["notes"]),
    ).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.rollbackPlugin, ["notes"]),
    ).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.removePlugin, ["notes"]),
    ).not.toThrow();
    for (const args of [[], ["notes"], ["notes", "true"], [42, true]])
      expect(() => validateCommand(CHANNEL.setPluginEnabled, args)).toThrow();
    expect(() => validateCommand(CHANNEL.installPlugin, ["notes"])).toThrow();
    for (const channel of [
      CHANNEL.updatePlugin,
      CHANNEL.rollbackPlugin,
      CHANNEL.removePlugin,
    ]) {
      expect(() => validateCommand(channel, [])).toThrow();
      expect(() => validateCommand(channel, ["notes", "extra"])).toThrow();
    }
  });

  it("accepts creating a plugin and saving its authored contents", () => {
    expect(() =>
      validateCommand(CHANNEL.createPlugin, ["Weather Pro", "Weather tools."]),
    ).not.toThrow();
    const contents = {
      displayName: "Weather Pro",
      description: "Weather tools.",
      skills: [
        {
          id: "fetch-forecast",
          description: "Look up a forecast.",
          instructions: "Call the forecast tool.",
        },
      ],
      specialists: [
        {
          id: "route-planner",
          name: "Route planner",
          description: "Plans routes.",
          instructions: "Avoid storms.",
        },
      ],
      mcpServers: [
        {
          id: "weather-api",
          name: "Weather API",
          description: "Live weather data.",
          url: "https://example.com/mcp",
        },
      ],
    };
    expect(() =>
      validateCommand(CHANNEL.savePluginContents, ["weather-pro", contents]),
    ).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.setComponentEnabled, [
        "weather-pro/route-planner",
        false,
      ]),
    ).not.toThrow();

    expect(() =>
      validateCommand(CHANNEL.createPlugin, ["", "Weather tools."]),
    ).toThrow();
    expect(() =>
      validateCommand(CHANNEL.savePluginContents, [
        "weather-pro",
        { ...contents, skills: [{ id: "fetch-forecast" }] },
      ]),
    ).toThrow();
    expect(() =>
      validateCommand(CHANNEL.setComponentEnabled, [
        "weather-pro/route-planner",
      ]),
    ).toThrow();

    expect(() =>
      validateCommand(CHANNEL.editablePluginContents, ["weather-pro"]),
    ).not.toThrow();
    expect(() => validateCommand(CHANNEL.editablePluginContents, [])).toThrow();
  });

  it("accepts MCP tool enable/disable and a connection test", () => {
    expect(() =>
      validateCommand(CHANNEL.setMcpServerToolEnabled, [
        "notes",
        "search",
        false,
      ]),
    ).not.toThrow();
    const draft = {
      id: "draft",
      name: "Draft",
      url: "https://example.com/mcp",
      enabled: true,
    };
    expect(() =>
      validateCommand(CHANNEL.testMcpConnection, [draft]),
    ).not.toThrow();
    expect(() =>
      validateCommand(CHANNEL.testMcpConnection, [draft, "a-token"]),
    ).not.toThrow();

    for (const args of [
      [],
      ["notes"],
      ["notes", "search"],
      ["notes", "search", "x"],
    ])
      expect(() =>
        validateCommand(CHANNEL.setMcpServerToolEnabled, args),
      ).toThrow();
    expect(() => validateCommand(CHANNEL.testMcpConnection, [])).toThrow();
    expect(() =>
      validateCommand(CHANNEL.testMcpConnection, [
        { ...draft, url: undefined },
      ]),
    ).toThrow();
  });

  it("accepts only well-formed browser intents", () => {
    for (const intent of [
      { kind: "open" },
      { kind: "open", url: "https://example.com/" },
      { kind: "close" },
      { kind: "navigate", url: "https://example.com/" },
      { kind: "back" },
      { kind: "click", x: 10, y: 20 },
      { kind: "scroll", x: 1, y: 2, deltaY: -120 },
      { kind: "type", text: "hej" },
      { kind: "key", key: "Enter" },
    ]) {
      expect(() =>
        validateCommand(CHANNEL.driveBrowser, [intent]),
      ).not.toThrow();
    }
    for (const intent of [
      {},
      { kind: "explode" },
      { kind: "close", url: "https://example.com/" },
      { kind: "navigate" },
      { kind: "navigate", url: "x".repeat(4001) },
      { kind: "click", x: 10 },
      { kind: "click", x: Number.NaN, y: 1 },
      { kind: "click", x: Number.POSITIVE_INFINITY, y: 1 },
      { kind: "type", text: "x".repeat(10_001) },
      { kind: "key", key: "x".repeat(33) },
    ]) {
      expect(() => validateCommand(CHANNEL.driveBrowser, [intent])).toThrow();
    }
    expect(() => validateCommand(CHANNEL.driveBrowser, [])).toThrow();
  });
});
