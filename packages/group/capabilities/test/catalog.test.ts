import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import type {
  CatalogEntry,
  ConnectionTool,
  KnowledgeSource,
  ToolSpec,
} from "@zhiyin/contract";
import {
  InMemoryMcpCredentials,
  ManagedMcpServers,
  type BuiltInMcpServer,
} from "@zhiyin/mcp";
import {
  ComposedPlugins,
  FilePluginSettings,
  FilePluginStore,
  loadBuiltInPlugins,
  type PluginView,
  type Plugins,
} from "@zhiyin/plugins";
import { ComposedCapabilities, declaredConnectionsOf } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const switchedOff =
  "That plugin is switched off. The person can switch it on in Plugins.";

function tool(
  name: string,
  toolkit?: string,
  parameters: readonly string[] = [],
): ConnectionTool {
  return {
    name,
    description: `Does ${name.replace(/_/g, " ")}.\nMore detail on a second line.`,
    label: name.replace(/^studio_/, "").replace(/_/g, " "),
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        parameters.map((parameter) => [parameter, { type: "string" }]),
      ),
    },
    ...(toolkit ? { toolkit } : {}),
  };
}

/** Eleven tools: two cores and five toolkits. */
const studioTools: readonly ConnectionTool[] = [
  tool("studio_open_scene"),
  tool("studio_render"),
  tool("studio_add_objects", "modelling", ["objects"]),
  tool("studio_edit_objects", "modelling", ["objects"]),
  tool("studio_shape_objects", "modelling", ["bevel_width"]),
  tool("studio_set_material", "surfacing", ["finish", "base_color"]),
  tool("studio_set_camera", "light-and-camera", ["focal_length"]),
  tool("studio_set_lighting", "light-and-camera"),
  tool("studio_animate", "motion"),
  tool("studio_render_video", "motion"),
  tool("studio_export", "output", ["format"]),
];

/** Three tools tagged with a toolkit, in a plugin small enough to be all core. */
const gitTools: readonly ConnectionTool[] = [
  tool("git_log", "history"),
  tool("git_diff", "history"),
  tool("git_status", "history"),
];

const view = (
  name: string,
  overrides: Partial<PluginView> = {},
): PluginView => ({
  manifest: {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name,
    version: "1.0.0",
    description: `The ${name} plugin.`,
    author: { name: "Zhiyin" },
    displayName: name,
    category: "Other",
    defaultPrompts: [],
  },
  provenance: { source: "built-in", sourceId: "shipped" },
  enabled: true,
  editing: "override",
  skills: [],
  specialists: [],
  mcpServers: [],
  appConnectors: [],
  ...overrides,
});

const appConnector = (plugin: string, connector: string) => ({
  id: `${plugin}/${connector}`,
  connector,
  name: connector,
  description: `The ${connector} connector.`,
  access: "On this computer.",
  dataDestination: "Nowhere.",
  enabled: true,
});

const skill = (
  id: string,
  extra: Partial<PluginView["skills"][number]> = {},
): PluginView["skills"][number] => ({
  id,
  name: id.split("/")[1]!,
  description: `What ${id} is for.`,
  instructions: `The instructions of ${id}.`,
  enabled: true,
  ...extra,
});

function rendering(overrides: Partial<PluginView> = {}): PluginView {
  return view("3d-rendering", {
    skills: [
      skill("3d-rendering/scene-stages", {
        description: "The stages of a 3D job.",
        stages: ["brief", "block-out"],
        domains: ["interior"],
        needs: ["3d-rendering/checks", "software-engineering/test-first"],
        worksWith: ["3d-rendering/lathe"],
      }),
      skill("3d-rendering/checks"),
      skill("3d-rendering/lathe", {
        description: "Turn a profile into a round part.",
      }),
    ],
    specialists: [
      {
        id: "3d-rendering/scene-critic",
        name: "Scene critic",
        description: "Judges a render.",
        instructions: "Look at the render.",
        enabled: true,
      },
    ],
    appConnectors: [appConnector("3d-rendering", "studio")],
    ...overrides,
  });
}

function engineering(overrides: Partial<PluginView> = {}): PluginView {
  return view("software-engineering", {
    skills: [skill("software-engineering/test-first")],
    mcpServers: [
      {
        id: "software-engineering/github",
        name: "GitHub",
        description: "Repositories, issues and pull requests.",
        type: "streamable-http",
        url: "https://api.githubcopilot.com/mcp/",
        access: "Needs a GitHub token.",
        dataDestination: "api.githubcopilot.com",
        enabled: true,
      },
    ],
    appConnectors: [appConnector("software-engineering", "git")],
    ...overrides,
  });
}

const knowledge: KnowledgeSource = {
  plugin: "3d-rendering",
  toolkits: [
    {
      id: "surfacing",
      title: "Surfacing",
      summary: "Materials and finishes for objects.",
    },
  ],
  breaks: [],
  entries: async () => [
    {
      id: "doc:blender/5.2/bpy.types.NodesModifier",
      kind: "doc",
      title: "bpy.types.NodesModifier",
      summary: "A modifier that runs a geometry nodes group.",
      plugin: "3d-rendering",
    },
    {
      id: "break:blender/5.2/socket-index",
      kind: "break",
      title: "Geometry nodes input by index",
      summary: "Reading a modifier input by its old index fails.",
      plugin: "3d-rendering",
    },
  ],
  page: async (id) =>
    id === "doc:blender/5.2/bpy.types.NodesModifier"
      ? {
          entry: (await knowledge.entries()).find((item) => item.id === id)!,
          text: "NodesModifier: node_group, show_viewport.",
        }
      : undefined,
};

function builtIn(
  id: string,
  tools: readonly ConnectionTool[],
  opened: string[],
): BuiltInMcpServer {
  return {
    id,
    name: id,
    scope: "conversation",
    describe: async () => tools,
    open: async (scope) => {
      opened.push(`${id} ${scope}`);
      return {
        listTools: async () => tools,
        callTool: async () => ({ content: [{ type: "text", text: "Done." }] }),
        close: async () => {},
      };
    },
  };
}

function pluginsHolding(initial: readonly PluginView[]): Plugins {
  let views = [...initial];
  const refuse = async (): Promise<never> => {
    throw new Error("not used here");
  };
  return {
    list: async () => views,
    damaged: async () => [],
    builtInNames: async () => views.map((item) => item.manifest.name),
    setEnabled: async (name, enabled) => {
      views = views.map((item) =>
        item.manifest.name === name ? { ...item, enabled } : item,
      );
    },
    setComponentEnabled: refuse,
    overrideComponent: refuse,
    resetComponent: refuse,
    install: refuse,
    update: refuse,
    rollback: refuse,
    remove: refuse,
    create: refuse,
    saveContents: refuse,
  };
}

const opened: ManagedMcpServers[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((mcp) => mcp.shutdownAll()));
});

async function composed(
  views: readonly PluginView[] = [rendering(), engineering()],
  connections: Record<string, readonly ConnectionTool[]> = {
    studio: studioTools,
    git: gitTools,
  },
  sources: readonly KnowledgeSource[] = [knowledge],
) {
  const plugins = pluginsHolding(views);
  const dialled: string[] = [];
  const builtInsOpened: string[] = [];
  const mcp = new ManagedMcpServers(
    await folders.make("zhiyin-catalog-"),
    async (definition) => {
      dialled.push(definition.id);
      return {
        listTools: async () => [
          { name: "search_issues", description: "Search issues." },
        ],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      };
    },
    new InMemoryMcpCredentials(),
    {
      builtIns: Object.entries(connections).map(([id, tools]) =>
        builtIn(id, tools, builtInsOpened),
      ),
      declared: () => declaredConnectionsOf(plugins),
    },
  );
  opened.push(mcp);
  const capabilities = new ComposedCapabilities({
    tools: {
      list: () => [],
      inspect: async () => ({ ok: false, reason: "none" }),
      execute: async () => ({ ok: false, reason: "none" }),
    },
    mcp,
    plugins,
    toolchains: {
      state: async () => ({ status: "ready", version: "1" }),
      install: async () => {},
      executable: async () => undefined,
    },
    connectionToolchains: {},
    browsers: {
      browser: () => {
        throw new Error("never driven here");
      },
      close: async () => {},
      forget: async () => {},
      closeAll: async () => {},
    },
    knowledge: sources,
  });
  return { capabilities, plugins, dialled, builtInsOpened };
}

async function gathered(
  capabilities: ComposedCapabilities,
  activatedPlugins: readonly string[] = [],
) {
  const gathering = await capabilities.toolsFor("conversation-1", {
    skills: true,
    activatedPlugins,
  });
  if (!gathering.ok) throw new Error(gathering.reason);
  return gathering.value;
}

const names = (tools: readonly ToolSpec[]) => tools.map((item) => item.name);
const ids = (entries: readonly CatalogEntry[]) =>
  entries.map((item) => item.id);

describe("a plugin's tools by toolkit", () => {
  it("offers an activated plugin's core tools, and its toolkits' tools only as toolkits", async () => {
    const { capabilities } = await composed();

    const offer = await gathered(capabilities, ["3d-rendering"]);

    expect(names(offer.tools)).toEqual([
      "mcp__studio__studio_open_scene",
      "mcp__studio__studio_render",
    ]);
    expect(
      offer.toolkits.map((toolkit) => [toolkit.id, names(toolkit.tools)]),
    ).toEqual([
      [
        "toolkit:3d-rendering/modelling",
        [
          "mcp__studio__studio_add_objects",
          "mcp__studio__studio_edit_objects",
          "mcp__studio__studio_shape_objects",
        ],
      ],
      ["toolkit:3d-rendering/surfacing", ["mcp__studio__studio_set_material"]],
      [
        "toolkit:3d-rendering/light-and-camera",
        ["mcp__studio__studio_set_camera", "mcp__studio__studio_set_lighting"],
      ],
      [
        "toolkit:3d-rendering/motion",
        ["mcp__studio__studio_animate", "mcp__studio__studio_render_video"],
      ],
      ["toolkit:3d-rendering/output", ["mcp__studio__studio_export"]],
    ]);
    expect(offer.toolkits[1]).toMatchObject({
      plugin: "3d-rendering",
      tools: [{ toolkit: "3d-rendering/surfacing", label: "set material" }],
    });
  });

  it("offers every enabled plugin's toolkits before it is activated, and none of its tools", async () => {
    const { capabilities, builtInsOpened } = await composed();

    const offer = await gathered(capabilities);

    expect(names(offer.tools)).toEqual([]);
    expect(offer.toolkits.map((toolkit) => toolkit.id)).toContain(
      "toolkit:3d-rendering/surfacing",
    );
    // Known from what the studio says of itself: no conversation's is opened.
    expect(builtInsOpened).toEqual([]);
  });

  it("names who answers for a toolkit's tool before it is opened", async () => {
    const { capabilities } = await composed();

    const offer = await gathered(capabilities, ["3d-rendering"]);

    expect(offer.ownerOf("mcp__studio__studio_set_material")).toBe("mcp");
    expect(offer.ownerOf("mcp__studio__studio_render")).toBe("mcp");
    expect(offer.ownerOf("load_skill")).toBeUndefined();
    expect(offer.ownerOf("inspect_plugin")).toBeUndefined();
  });

  it("treats a plugin of ten tools or fewer as all core, whatever its tools say", async () => {
    const { capabilities } = await composed();

    const offer = await gathered(capabilities, ["software-engineering"]);

    expect(names(offer.tools)).toEqual(
      expect.arrayContaining([
        "mcp__git__git_log",
        "mcp__git__git_diff",
        "mcp__git__git_status",
      ]),
    );
    expect(offer.tools.every((item) => item.toolkit === undefined)).toBe(true);
    expect(
      offer.toolkits.filter((item) => item.plugin === "software-engineering"),
    ).toEqual([]);
    expect(
      ids(
        await capabilities.catalogFind("conversation-1", "history", "toolkit"),
      ),
    ).toEqual([]);
  });

  it("refuses a toolkit of more than ten tools, naming it", async () => {
    const crowded = Array.from({ length: 11 }, (_, number) =>
      tool(`studio_step_${number}`, "everything"),
    );
    const { capabilities } = await composed([rendering()], {
      studio: [tool("studio_render"), ...crowded],
    });
    const reason =
      "The toolkit “toolkit:3d-rendering/everything” holds 11 tools; a toolkit holds at most 10.";

    expect(
      await capabilities.toolsFor("conversation-1", { skills: true }),
    ).toEqual({ ok: false, reason });
    await expect(
      capabilities.catalogFind("conversation-1", "step"),
    ).rejects.toThrow(reason);
    expect(
      await capabilities.catalogOpen(
        "conversation-1",
        "toolkit:3d-rendering/everything",
      ),
    ).toEqual({ ok: false, reason });
  });
});

describe("the plugin directory", () => {
  it("is the same before and after a plugin is activated", async () => {
    const { capabilities } = await composed();

    const before = (await gathered(capabilities)).pluginDirectory;
    const after = (await gathered(capabilities, ["3d-rendering"]))
      .pluginDirectory;

    expect(after).toEqual(before);
    expect(before[0]).toEqual({
      id: "3d-rendering",
      name: "3d-rendering",
      purpose: "The 3d-rendering plugin.",
      includes: {
        skills: [
          {
            id: "skill:3d-rendering/scene-stages",
            description: "The stages of a 3D job.",
          },
          {
            id: "skill:3d-rendering/checks",
            description: "What 3d-rendering/checks is for.",
          },
          {
            id: "skill:3d-rendering/lathe",
            description: "Turn a profile into a round part.",
          },
        ],
        specialists: ["Scene critic"],
        connectors: ["studio — The studio connector."],
        toolkits: [
          "toolkit:3d-rendering/modelling",
          "toolkit:3d-rendering/surfacing",
          "toolkit:3d-rendering/light-and-camera",
          "toolkit:3d-rendering/motion",
          "toolkit:3d-rendering/output",
        ],
      },
    });
    expect(before[1]?.includes.toolkits).toEqual([
      "toolkit:software-engineering/github",
    ]);
  });

  it("offers every enabled plugin's skills and specialists, activated or not", async () => {
    const { capabilities } = await composed();

    const offer = await gathered(capabilities);

    expect(offer.skills.map((item) => item.id)).toEqual([
      "3d-rendering/scene-stages",
      "3d-rendering/checks",
      "3d-rendering/lathe",
      "software-engineering/test-first",
    ]);
    expect(offer.specialists.map((item) => item.id)).toEqual([
      "3d-rendering/scene-critic",
    ]);
  });
});

describe("finding in the catalog", () => {
  it("finds a toolkit by what its tools do and take, in its own words", async () => {
    const { capabilities } = await composed();

    const found = await capabilities.catalogFind(
      "conversation-1",
      "material finish base color",
    );

    expect(found[0]).toEqual({
      id: "toolkit:3d-rendering/surfacing",
      kind: "toolkit",
      title: "Surfacing",
      summary: "Materials and finishes for objects.",
      plugin: "3d-rendering",
      terms: [
        "mcp__studio__studio_set_material",
        "set material",
        "finish",
        "base_color",
      ],
    });
  });

  it("names a toolkit nothing describes by its id and its tools", async () => {
    const { capabilities } = await composed();

    const [found] = await capabilities.catalogFind(
      "conversation-1",
      "focal length",
      "toolkit",
    );

    expect(found).toMatchObject({
      id: "toolkit:3d-rendering/light-and-camera",
      title: "light-and-camera",
      summary: "set camera, set lighting",
    });
  });

  it("finds entries of each kind, and only of the kind asked for", async () => {
    const { capabilities } = await composed();
    const find = (query: string, kind?: CatalogEntry["kind"]) =>
      capabilities
        .catalogFind("conversation-1", query, kind)
        .then((entries) => ids(entries));

    expect((await find("stages block-out interior", "skill"))[0]).toBe(
      "skill:3d-rendering/scene-stages",
    );
    expect(await find("geometry nodes modifier", "doc")).toEqual([
      "doc:blender/5.2/bpy.types.NodesModifier",
    ]);
    expect(await find("geometry nodes modifier", "break")).toEqual([
      "break:blender/5.2/socket-index",
    ]);
    expect(await find("geometry nodes modifier", "function")).toEqual([]);
    expect(await find("issues pull requests", "toolkit")).toEqual([
      "toolkit:software-engineering/github",
    ]);
  });

  it("returns five entries at most", async () => {
    const many = Array.from({ length: 8 }, (_, number) =>
      skill(`3d-rendering/camera-${number}`, {
        description: "Camera work.",
      }),
    );
    const { capabilities } = await composed([rendering({ skills: many })]);

    expect(
      await capabilities.catalogFind("conversation-1", "camera"),
    ).toHaveLength(5);
  });

  it("stops finding a plugin's entries once it is switched off, after they were found", async () => {
    const { capabilities, plugins } = await composed();
    const query = "stages material geometry nodes modifier";
    expect(
      (await capabilities.catalogFind("conversation-1", query)).map(
        (item) => item.plugin,
      ),
    ).toContain("3d-rendering");

    await plugins.setEnabled("3d-rendering", false);

    expect(
      (await capabilities.catalogFind("conversation-1", query)).filter(
        (item) => item.plugin === "3d-rendering",
      ),
    ).toEqual([]);
  });

  it("finds a page a knowledge source adds after an earlier search", async () => {
    const pages: CatalogEntry[] = [];
    const growing: KnowledgeSource = {
      ...knowledge,
      entries: async () => [...pages],
    };
    const { capabilities: withGrowing } = await composed(undefined, undefined, [
      growing,
    ]);
    expect(
      await withGrowing.catalogFind("conversation-1", "armature", "doc"),
    ).toEqual([]);

    pages.push({
      id: "doc:blender/5.2/bpy.types.Armature",
      kind: "doc",
      title: "bpy.types.Armature",
      summary: "Bones that pose a mesh.",
      plugin: "3d-rendering",
    });

    expect(
      ids(await withGrowing.catalogFind("conversation-1", "armature", "doc")),
    ).toEqual(["doc:blender/5.2/bpy.types.Armature"]);
  });

  it("never offers what a switched-off plugin brings", async () => {
    const { capabilities, plugins } = await composed();
    await plugins.setEnabled("3d-rendering", false);

    const found = await capabilities.catalogFind(
      "conversation-1",
      "stages material geometry nodes modifier",
    );

    expect(found.filter((item) => item.plugin === "3d-rendering")).toEqual([]);
    expect((await gathered(capabilities, ["3d-rendering"])).toolkits).toEqual(
      [],
    );
  });
});

describe("opening a catalog entry", () => {
  it("answers a skill as guidance: its instructions, what it needs, and what else to open", async () => {
    const { capabilities } = await composed();

    const opening = await capabilities.catalogOpen(
      "conversation-1",
      "skill:3d-rendering/scene-stages",
    );

    expect(opening).toMatchObject({
      ok: true,
      voice: "guidance",
      plugin: "3d-rendering",
      entry: { id: "skill:3d-rendering/scene-stages", kind: "skill" },
    });
    if (!opening.ok) throw new Error(opening.reason);
    expect(opening.tools).toBeUndefined();
    expect(opening.text).toBe(
      [
        "The instructions of 3d-rendering/scene-stages.",
        "---",
        "skill:3d-rendering/checks, which this skill needs:",
        "The instructions of 3d-rendering/checks.",
        "---",
        "This skill also needs skill:software-engineering/test-first: open it now.",
        "Open as well each of these that applies to this work: skill:3d-rendering/lathe.",
      ].join("\n\n"),
    );
  });

  it("brings with a shipped skill the skills its needs declare", async () => {
    const data = await folders.make("zhiyin-plugins-");
    const shipped = await new ComposedPlugins({
      builtIns: () =>
        loadBuiltInPlugins(
          fileURLToPath(
            new URL("../../../feature/plugins/built-in", import.meta.url),
          ),
        ),
      store: new FilePluginStore(join(data, "plugins")),
      settings: new FilePluginSettings(data),
    }).list();
    const { capabilities } = await composed(shipped, {});
    const mechanical = shipped
      .flatMap((item) => item.skills)
      .find((item) => item.id === "3d-rendering/mechanical-design");

    const opening = await capabilities.catalogOpen(
      "conversation-1",
      "skill:3d-rendering/realistic-machines",
    );

    if (!opening.ok) throw new Error(opening.reason);
    expect(opening.text).toContain(
      `skill:3d-rendering/mechanical-design, which this skill needs:\n\n${mechanical?.instructions}`,
    );
    expect(mechanical?.instructions.length).toBeGreaterThan(100);
  });

  it("hands the shipped 3D reviewers tools their studios offer, by the names the studios give them", async () => {
    const data = await folders.make("zhiyin-plugins-");
    const shipped = await new ComposedPlugins({
      builtIns: () =>
        loadBuiltInPlugins(
          fileURLToPath(
            new URL("../../../feature/plugins/built-in", import.meta.url),
          ),
        ),
      store: new FilePluginStore(join(data, "plugins")),
      settings: new FilePluginSettings(data),
    }).list();
    const looking = [
      "blender_look",
      "blender_describe_scene",
      "blender_close_ups",
      "blender_frame_sheet",
    ];
    const { capabilities } = await composed(shipped, {
      blender: looking.map((name) => ({ name, description: name })),
      cad: [{ name: "cad_api", description: "cad_api" }],
    });

    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: false,
      activatedPlugins: ["3d-rendering"],
    });

    if (!gathered.ok) throw new Error(gathered.reason);
    const offered = [
      ...gathered.value.tools,
      ...gathered.value.toolkits.flatMap((toolkit) => toolkit.tools),
    ];
    // A tool the reviewer names, as one of its plugin's connections offers it.
    const reached = (id: string, name: string) => {
      const specialist = gathered.value.specialists.find(
        (one) => one.id === id,
      );
      return (
        !!specialist?.tools?.includes(name) &&
        offered.some(
          (tool) =>
            tool.connection?.tool === name &&
            !!specialist.connections?.includes(tool.connection.id),
        )
      );
    };
    for (const name of looking)
      expect(reached("3d-rendering/scene-reviewer", name), name).toBe(true);
    expect(reached("3d-rendering/part-reviewer", "cad_api")).toBe(true);
  });

  it("answers a toolkit as guidance: its tools, and a line on each", async () => {
    const { capabilities } = await composed();

    const opening = await capabilities.catalogOpen(
      "conversation-1",
      "toolkit:3d-rendering/light-and-camera",
    );

    if (!opening.ok) throw new Error(opening.reason);
    expect(opening.voice).toBe("guidance");
    expect(opening.plugin).toBe("3d-rendering");
    expect(names(opening.tools ?? [])).toEqual([
      "mcp__studio__studio_set_camera",
      "mcp__studio__studio_set_lighting",
    ]);
    expect(opening.text).toBe(
      [
        "mcp__studio__studio_set_camera: Does studio set camera.",
        "mcp__studio__studio_set_lighting: Does studio set lighting.",
      ].join("\n"),
    );
  });

  it("answers a page or an API change as reference", async () => {
    const { capabilities } = await composed();

    const page = await capabilities.catalogOpen(
      "conversation-1",
      "doc:blender/5.2/bpy.types.NodesModifier",
    );

    expect(page).toMatchObject({
      ok: true,
      voice: "reference",
      plugin: "3d-rendering",
      text: "NodesModifier: node_group, show_viewport.",
      entry: { id: "doc:blender/5.2/bpy.types.NodesModifier" },
    });
  });

  it("refuses an id nothing in the catalog has", async () => {
    const { capabilities } = await composed();

    for (const id of [
      "skill:3d-rendering/nothing",
      "toolkit:software-engineering/history",
      "doc:blender/5.2/bpy.types.Nothing",
      "nothing",
    ])
      expect(await capabilities.catalogOpen("conversation-1", id)).toEqual({
        ok: false,
        reason: `Nothing in the catalog has the id “${id}”. Use find to look up ids.`,
      });
  });

  it("refuses what a switched-off plugin brings, saying where it is switched on", async () => {
    const { capabilities, plugins } = await composed();
    await plugins.setEnabled("3d-rendering", false);

    for (const id of [
      "skill:3d-rendering/scene-stages",
      "toolkit:3d-rendering/surfacing",
      "doc:blender/5.2/bpy.types.NodesModifier",
    ])
      expect(await capabilities.catalogOpen("conversation-1", id)).toEqual({
        ok: false,
        reason: switchedOff,
      });
  });

  it("does not activate the plugin: its tools stay withheld until the conversation activates it", async () => {
    const { capabilities } = await composed();
    await gathered(capabilities);

    await capabilities.catalogOpen(
      "conversation-1",
      "toolkit:3d-rendering/surfacing",
    );

    expect(
      await capabilities.execute(
        "conversation-1",
        "mcp",
        "mcp__studio__studio_set_material",
        {},
      ),
    ).toMatchObject({ ok: false });
    await gathered(capabilities, ["3d-rendering"]);
    expect(
      await capabilities.execute(
        "conversation-1",
        "mcp",
        "mcp__studio__studio_set_material",
        {},
      ),
    ).toMatchObject({ ok: true });
  });

  it("reaches a remote connector only once it is opened, and lists what it offers", async () => {
    const { capabilities, dialled } = await composed();

    await gathered(capabilities);
    await capabilities.catalogFind("conversation-1", "github", "toolkit");
    expect(dialled).toEqual([]);

    const opening = await capabilities.catalogOpen(
      "conversation-1",
      "toolkit:software-engineering/github",
    );

    expect(dialled).toEqual(["software-engineering/github"]);
    expect(opening).toEqual({
      ok: true,
      voice: "guidance",
      plugin: "software-engineering",
      entry: {
        id: "toolkit:software-engineering/github",
        kind: "toolkit",
        title: "GitHub",
        summary: "Repositories, issues and pull requests.",
        plugin: "software-engineering",
      },
      text: "mcp__software-engineering__github__search_issues: Search issues.",
    });
  });
});
