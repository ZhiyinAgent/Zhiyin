import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALLOWED_EXTERNAL_URLS } from "@zhiyin/contract";
import { loadBuiltInPlugins, type PluginMcpServer } from "../src/index.js";

const shipped = fileURLToPath(new URL("../built-in", import.meta.url));

/**
 * The tools a shipped declaration says only read, as a read-only specialist
 * is offered them: each that changes nothing, acts as no one, runs nothing
 * and leaves nothing behind, in a set the declaration keeps from no one.
 */
const readingTools = (server: PluginMcpServer) =>
  (server.toolEffects ?? [])
    .filter(
      ({ effects, notReadOnly }) =>
        notReadOnly === undefined &&
        effects.changes === "none" &&
        effects.actsAsPerson === "none" &&
        effects.runs === "none" &&
        !effects.lasting,
    )
    .flatMap((group) => group.tools);

const local = (ids: readonly { id: string }[]) =>
  ids.map((item) => item.id.slice(item.id.indexOf("/") + 1));

describe("the catalog shipped with the application", () => {
  it("offers the five verticals, each with exactly its planned skills, specialists, and connectors", async () => {
    const plugins = await loadBuiltInPlugins(shipped);

    expect(
      plugins.map((plugin) => ({
        name: plugin.manifest.name,
        displayName: plugin.manifest.displayName,
        skills: local(plugin.skills),
        specialists: local(plugin.specialists),
        connectors: [
          ...local(plugin.mcpServers),
          ...plugin.appConnectors.map((item) => `app:${item.connector}`),
        ],
      })),
    ).toEqual([
      {
        name: "engineering",
        displayName: "Full-Stack Software Engineering",
        skills: [
          "backend-api-patterns",
          "database-architecture-and-design",
          "frontend-design-systems",
          "system-architecture",
          "test-driven-development",
        ],
        specialists: [
          "code-reviewer",
          "interactive-debugger",
          "refactoring-architect",
          "qa-e2e-verifier",
        ],
        connectors: ["github", "app:browser", "app:git"],
      },
      {
        name: "publishing",
        displayName: "Technical & Academic Publishing",
        skills: [
          "bibliography-hygiene",
          "diagram-engineering",
          "latex-typst-authoring",
          "whitepaper-structure",
        ],
        specialists: ["peer-review-critic", "citation-auditor"],
        connectors: ["alphaxiv", "app:documents"],
      },
      {
        name: "data-science",
        displayName: "Data Science & Business Intelligence",
        skills: [
          "dashboard-design",
          "exploratory-data-analysis",
          "spreadsheets",
          "sql-optimization",
          "statistical-testing",
        ],
        specialists: ["data-cleansing-specialist", "insights-synthesizer"],
        connectors: ["app:python"],
      },
      {
        name: "research",
        displayName: "Deep Research & Synthesis",
        skills: [
          "competitive-analysis",
          "knowledge-graph-mapping",
          "neutrality-review",
          "source-triangulation",
        ],
        specialists: ["fact-checker", "report-synthesizer"],
        connectors: ["tavily"],
      },
      {
        name: "3d-rendering",
        displayName: "3D & Rendering",
        skills: [
          "animations",
          "cad-feature-order",
          "hard-surface-bevels",
          "interiors-from-plans",
          "lathe-profiles",
          "making-assets",
          "mechanical-design",
          "part-stages",
          "printable-parts",
          "product-renders",
          "realistic-machines",
          "rigging",
          "scene-building",
          "scene-stages",
          "sculpting",
          "set-dressing",
          "simulations",
          "subd-modelling",
        ],
        specialists: ["scene-reviewer", "part-reviewer"],
        connectors: ["app:blender", "app:cad"],
      },
    ]);
  });

  it("names only shipped skills as the ones a shipped skill needs or works with", async () => {
    const skills = (await loadBuiltInPlugins(shipped)).flatMap(
      (plugin) => plugin.skills,
    );
    const ids = new Set(skills.map((skill) => skill.id));

    for (const skill of skills)
      for (const named of [...(skill.needs ?? []), ...(skill.worksWith ?? [])])
        expect(ids.has(named), `${skill.id} names ${named}`).toBe(true);
  });

  it("loads mechanical design with realistic machines, and names it to the skills whose work may need it", async () => {
    const skills = new Map(
      (await loadBuiltInPlugins(shipped))
        .flatMap((plugin) => plugin.skills)
        .map((skill) => [skill.id, skill]),
    );
    const mechanical = "3d-rendering/mechanical-design";

    expect(skills.get("3d-rendering/realistic-machines")?.needs).toEqual([
      mechanical,
    ]);
    for (const id of [
      "3d-rendering/printable-parts",
      "3d-rendering/scene-building",
      "3d-rendering/animations",
    ])
      expect(skills.get(id)?.worksWith, id).toContain(mechanical);
  });

  it("paces Tavily within the rate its development keys allow", async () => {
    // Tavily allows a development key 100 requests a minute, and a person's
    // key type cannot be read without spending quota, so the smaller one holds.
    const research = (await loadBuiltInPlugins(shipped)).find(
      (plugin) => plugin.manifest.name === "research",
    );
    const tavily = research?.mcpServers.find((server) =>
      server.id.endsWith("/tavily"),
    );

    expect(tavily?.requestsPerMinute).toBe(100);
  });

  it("waits for a Tavily research task longer than the 15 minutes it may poll for", async () => {
    // tavily-mcp polls a pro or auto research task for up to 15 minutes.
    const research = (await loadBuiltInPlugins(shipped)).find(
      (plugin) => plugin.manifest.name === "research",
    );
    const tavily = research?.mcpServers.find((server) =>
      server.id.endsWith("/tavily"),
    );

    expect(tavily?.toolMinutes).toEqual({ tavily_research: 16 });
  });

  it("lets the research specialists search with Tavily: its tools that only read are known from what they do", async () => {
    const research = (await loadBuiltInPlugins(shipped)).find(
      (plugin) => plugin.manifest.name === "research",
    );
    const tavily = research?.mcpServers.find((server) =>
      server.id.endsWith("/tavily"),
    );

    expect(readingTools(tavily!)).toEqual(
      expect.arrayContaining(["tavily_search", "tavily_extract"]),
    );
  });

  it("lets the code reviewer read pull requests, files and commits on GitHub, and nothing that writes", async () => {
    const engineering = (await loadBuiltInPlugins(shipped)).find(
      (plugin) => plugin.manifest.name === "engineering",
    );
    const github = engineering?.mcpServers.find((server) =>
      server.id.endsWith("/github"),
    );

    expect(readingTools(github!)).toEqual(
      expect.arrayContaining([
        "pull_request_read",
        "get_file_contents",
        "list_commits",
        "search_code",
      ]),
    );
    for (const writes of [
      "add_issue_comment",
      "create_pull_request",
      "create_repository",
      "merge_pull_request",
      "push_files",
      "delete_repository",
    ])
      expect(readingTools(github!)).not.toContain(writes);
  });

  it("lets the citation auditor find and read papers with alphaXiv, and nothing of the person's own library, notes or follows", async () => {
    const publishing = (await loadBuiltInPlugins(shipped)).find(
      (plugin) => plugin.manifest.name === "publishing",
    );
    const alphaxiv = publishing?.mcpServers.find((server) =>
      server.id.endsWith("/alphaxiv"),
    );

    // The names alphaXiv's server listed on 2026-10-18.
    expect(readingTools(alphaxiv!)).toEqual(
      expect.arrayContaining([
        "discover_papers",
        "get_paper_content",
        "answer_pdf_queries",
        "read_files_from_github_repository",
      ]),
    );
    for (const own of [
      "list_library",
      "get_paper_notes",
      "list_annotated_papers",
      "get_for_you_feed",
      "list_followed_researchers",
      "save_papers_to_folder",
      "delete_folder",
      "follow_researcher",
    ])
      expect(readingTools(alphaxiv!)).not.toContain(own);
  });

  describe("what each tool of a shipped remote connector does", () => {
    // Every tool a shipped connector declares, by connector and tool, as
    // "sends / acts as the person / brings", and where an action lands.
    const declared = async () => {
      const said = new Map<string, string>();
      for (const server of (await loadBuiltInPlugins(shipped)).flatMap(
        (plugin) => plugin.mcpServers,
      ))
        for (const group of server.toolEffects ?? []) {
          // A remote tool touches nothing on this computer and runs nothing;
          // it may read the person's account on its service.
          expect(group.effects).toMatchObject({
            changes: "none",
            runs: "none",
            lasting: false,
          });
          expect(["none", "account"]).toContain(group.effects.reads);
          for (const tool of group.tools)
            said.set(
              `${server.name}: ${tool}`,
              [
                group.effects.sends,
                group.effects.actsAsPerson,
                group.effects.brings,
                ...(group.destination ? [group.destination] : []),
              ].join(" / "),
            );
        }
      return said;
    };

    it("says every send to a place the model chose carries the address alone: Tavily fetches what it is given and nothing of the model's words", async () => {
      for (const server of (await loadBuiltInPlugins(shipped)).flatMap(
        (plugin) => plugin.mcpServers,
      ))
        for (const group of server.toolEffects ?? [])
          if (group.effects.sends === "chosen")
            expect(group.effects.carries, group.tools.join(", ")).toBe(
              "address",
            );
    });

    it("reads the person's account only where their own data is: all of GitHub, and alphaXiv's library, follows, notes and feed", async () => {
      const account = new Set<string>();
      for (const server of (await loadBuiltInPlugins(shipped)).flatMap(
        (plugin) => plugin.mcpServers,
      ))
        for (const group of server.toolEffects ?? [])
          if (group.effects.reads === "account")
            for (const tool of group.tools)
              account.add(`${server.name}: ${tool}`);

      expect(
        [...account].filter((tool) => tool.startsWith("alphaXiv")).sort(),
      ).toEqual([
        "alphaXiv: get_for_you_feed",
        "alphaXiv: get_paper_notes",
        "alphaXiv: list_annotated_papers",
        "alphaXiv: list_followed_researchers",
        "alphaXiv: list_library",
      ]);
      expect([...account].some((tool) => tool.startsWith("Tavily"))).toBe(
        false,
      );
      expect(account.has("GitHub: get_me")).toBe(true);
      expect(account.has("GitHub: list_issues")).toBe(true);
    });

    it("Tavily searches through its own service, and reads the pages the model names", async () => {
      const said = await declared();

      expect(
        [
          "tavily_search",
          "tavily_research",
          "tavily_extract",
          "tavily_crawl",
          "tavily_map",
        ].map((tool) => said.get(`Tavily: ${tool}`)),
      ).toEqual([
        "service / none / outside",
        "service / none / outside",
        "chosen / none / outside / {urls}",
        "chosen / none / outside / {url}",
        "chosen / none / outside / {url}",
      ]);
    });

    it("alphaXiv reads papers and the person's library, and changes the library once at a time", async () => {
      const said = await declared();
      const publishing = (await loadBuiltInPlugins(shipped)).find(
        (plugin) => plugin.manifest.name === "publishing",
      );
      const alphaxiv = publishing?.mcpServers.find((server) =>
        server.id.endsWith("/alphaxiv"),
      );

      // Every tool alphaXiv's server listed on 2026-10-18, and those its
      // documentation listed on 2026-10-31.
      for (const tool of [
        ...readingTools(alphaxiv!),
        "get_for_you_feed",
        "get_hot_feed",
        "list_library",
        "list_followed_researchers",
        "get_paper_notes",
        "list_annotated_papers",
      ])
        expect(said.get(`alphaXiv: ${tool}`)).toBe("service / none / outside");
      for (const tool of [
        "save_papers_to_folder",
        "remove_papers_from_folder",
        "move_papers_between_folders",
        "create_folder",
        "rename_folder",
        "delete_folder",
        "edit_private_paper_metadata",
      ])
        expect(said.get(`alphaXiv: ${tool}`)).toBe(
          "service / once / outside / alphaXiv library",
        );
      for (const tool of ["follow_researcher", "unfollow_researcher"])
        expect(said.get(`alphaXiv: ${tool}`)).toBe(
          "service / once / outside / alphaXiv researchers followed",
        );
    });

    it("GitHub reads freely, asks once per repository for what can be taken back, and every time for what cannot", async () => {
      const said = await declared();

      expect(
        Object.fromEntries(
          [
            "search_code",
            "get_file_contents",
            "issue_read",
            "pull_request_read",
            "add_issue_comment",
            "issue_write",
            "create_pull_request",
            "create_branch",
            "fork_repository",
            "create_repository",
            "merge_pull_request",
            "push_files",
            "create_or_update_file",
            "delete_file",
            "delete_repository",
            "update_pull_request_branch",
            "pull_request_review_write",
          ].map((tool) => [tool, said.get(`GitHub: ${tool}`)]),
        ),
      ).toEqual({
        search_code: "service / none / outside",
        get_file_contents: "service / none / outside",
        issue_read: "service / none / outside",
        pull_request_read: "service / none / outside",
        add_issue_comment: "service / once / outside / {owner}/{repo}",
        issue_write: "service / once / outside / {owner}/{repo}",
        create_pull_request: "service / once / outside / {owner}/{repo}",
        create_branch: "service / once / outside / {owner}/{repo}",
        fork_repository: "service / once / outside / {owner}/{repo}",
        create_repository: "service / once / outside / {name}",
        merge_pull_request: "service / for-good / outside",
        push_files: "service / for-good / outside",
        create_or_update_file: "service / for-good / outside",
        delete_file: "service / for-good / outside",
        delete_repository: "service / for-good / outside",
        update_pull_request_branch: "service / for-good / outside",
        pull_request_review_write: "service / for-good / outside",
      });
    });

    it("says where every action that acts as the person once lands", async () => {
      for (const [tool, effects] of await declared())
        if (effects.includes(" / once / "))
          expect(effects, tool).toMatch(/ \/ outside \/ .+$/);
    });
  });

  it("says for every shipped connector what key it needs and where that key is made", async () => {
    const connectors = (await loadBuiltInPlugins(shipped)).flatMap(
      (plugin) => plugin.mcpServers,
    );

    expect(
      Object.fromEntries(
        connectors.map((server) => [
          server.name,
          [server.setup?.keyName, server.setup?.url],
        ]),
      ),
    ).toEqual({
      GitHub: [
        "personal access token",
        "https://github.com/settings/personal-access-tokens/new",
      ],
      alphaXiv: ["API key", "https://www.alphaxiv.org/settings"],
      Tavily: ["API key", "https://app.tavily.com/home"],
    });
    for (const server of connectors)
      expect(ALLOWED_EXTERNAL_URLS).toContain(server.setup?.url);
  });

  it("states what every plugin and connector can use and where its data goes", async () => {
    for (const plugin of await loadBuiltInPlugins(shipped)) {
      expect(plugin.manifest.accessSummary).toBeTruthy();
      expect(plugin.manifest.dataDestination).toBeTruthy();
      expect(plugin.manifest.defaultPrompts.length).toBeGreaterThan(0);
      for (const connector of [...plugin.mcpServers, ...plugin.appConnectors]) {
        expect(connector.access).toBeTruthy();
        expect(connector.dataDestination).toBeTruthy();
      }
    }
  });
});
