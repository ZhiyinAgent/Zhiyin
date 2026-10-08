import { readdirSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX, { createNodeResolver } from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";
import { builtinRules } from "eslint/use-at-your-own-risk";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

function entriesOf(directory) {
  return readdirSync(new URL(`./${directory}`, import.meta.url), {
    withFileTypes: true,
  });
}

const foldersIn = (directory) =>
  entriesOf(directory)
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

/*
 * Every workspace package sits in one layer and may import only the layers
 * below it (ADR 0002). Above the feature layer a package is used through its
 * interface, so only its types may be imported: a real implementation is
 * constructed in the composition root and handed in.
 */
const LAYERS = ["contract", "platform", "feature", "group", "loop", "core"];

const PACKAGE_LAYERS = {
  contract: "contract",
  "permission-engine": "feature",
  "conversation-rewind": "feature",
  recovery: "feature",
  artifacts: "feature",
  audit: "feature",
  tools: "feature",
  "process-ownership": "platform",
  "workspace-containment": "platform",
  "pdf-engine": "platform",
  mcp: "feature",
  toolchains: "feature",
  plugins: "feature",
  usage: "feature",
  views: "feature",
  session: "feature",
  "model-client": "feature",
  "interactive-browser": "feature",
  "git-connector": "feature",
  "document-compiler": "feature",
  "python-sandbox": "feature",
  "document-viewer": "feature",
  "conversation-export": "feature",
  spelling: "feature",
  capabilities: "group",
  rewind: "group",
  "agent-loop": "loop",
  core: "core",
};

/** The members each group presents as one. A group reaches nothing else. */
const GROUP_MEMBERS = {
  capabilities: [
    "tools",
    "mcp",
    "toolchains",
    "plugins",
    "interactive-browser",
    "git-connector",
    "document-compiler",
    "python-sandbox",
  ],
  rewind: ["conversation-rewind", "recovery"],
};

const groupJoining = (member) =>
  Object.keys(GROUP_MEMBERS).find((group) =>
    GROUP_MEMBERS[group].includes(member),
  );

/*
 * Above the group layer a member is reached through its group, so a caller
 * cannot go around the joining the group exists to do. Listed here are the
 * imports that are not what the group answers for, each with the reason — a
 * new one is a claim that the import is nothing the model can call, and has to
 * read as one.
 */
const MEMBER_IMPORTS_ALLOWED = {
  core: {
    "interactive-browser":
      "The browser panel a person watches and drives themselves. The capabilities group answers for what the model may call, and this is not that.",
  },
};

/**
 * A package without a declared layer would be held to no rule at all, so it
 * stops lint instead of slipping through.
 */
export function layerOfPackage(name) {
  const layer = PACKAGE_LAYERS[name];
  if (!layer)
    throw new Error(
      `The package "${name}" has no layer. Declare one in eslint.config.js before it can be linted (ADR 0002).`,
    );
  return layer;
}

const workspacePackages = foldersIn("packages");
for (const name of workspacePackages) layerOfPackage(name);

const rankOf = (name) => LAYERS.indexOf(layerOfPackage(name));

const unreachableMessage = {
  contract:
    "The contract is the shared vocabulary and imports nothing from the workspace.",
  platform:
    "Platform packages own operating-system mechanisms below features and depend only on @zhiyin/contract.",
  feature:
    "Features are composed, never coupled. A feature may depend on @zhiyin/contract and platform mechanisms, never another feature; a group, the agent loop or the core joins features together.",
  group:
    "A group joins its own members and nothing else. Anything more it needs is handed in by whoever composes it.",
  loop: "The agent loop does not import the core or another orchestrator; the core depends on the loop, not the reverse.",
  core: "The core does not import another orchestrator at its own level.",
};

function packageImportRule(name) {
  const layer = layerOfPackage(name);
  const others = workspacePackages.filter(
    (other) => other !== name && other !== "contract",
  );
  const reachable = others.filter((other) =>
    layer === "group"
      ? (GROUP_MEMBERS[name] ?? []).includes(other)
      : rankOf(other) < rankOf(name),
  );
  const unreachable = others.filter((other) => !reachable.includes(other));
  // A member of a group this package sits above, reached without going through
  // the group and without a listed reason.
  const throughGroup = ["loop", "core"].includes(layer)
    ? reachable.filter(
        (other) =>
          groupJoining(other) && !MEMBER_IMPORTS_ALLOWED[name]?.[other],
      )
    : [];
  const direct = reachable.filter(
    (other) =>
      !throughGroup.includes(other) &&
      !(layer === "feature" && layerOfPackage(other) === "platform"),
  );
  const patterns = [];
  if (layer === "contract" || unreachable.length)
    patterns.push({
      group: (layer === "contract" ? ["contract", ...others] : unreachable).map(
        (other) => `@zhiyin/${other}`,
      ),
      message: unreachableMessage[layer],
    });
  for (const group of new Set(throughGroup.map(groupJoining)))
    patterns.push({
      group: throughGroup
        .filter((member) => groupJoining(member) === group)
        .map((member) => `@zhiyin/${member}`),
      message: `@zhiyin/${group} presents these features as one. Reach them through it, so nothing goes around the joining the group exists to do. An import the group does not answer for is listed with its reason in eslint.config.js.`,
    });
  if (direct.length)
    patterns.push({
      group: direct.map((other) => `@zhiyin/${other}`),
      allowTypeImports: true,
      message:
        "Above the feature layer a package is used through its interface: import its types only. Real implementations are constructed in the composition root and handed in.",
    });
  return ["error", { patterns }];
}

/*
 * A feature's tests are held to the feature's rule, because a feature must be
 * testable with nothing else present. An orchestrator's tests may use real
 * implementations: that is what an integration test is for.
 */
const packageLayerRules = workspacePackages.map((name) => ({
  files: [
    ["contract", "feature"].includes(layerOfPackage(name))
      ? `packages/${name}/**/*.ts`
      : `packages/${name}/src/**/*.ts`,
  ],
  rules: {
    "@typescript-eslint/no-restricted-imports": packageImportRule(name),
  },
}));

/*
 * A length backstop, not a target. Structure comes from what a file is
 * responsible for; passing the backstop is a prompt to look at that, never an
 * instruction to split.
 */
const SOURCE_FILES = [
  "packages/*/src/**/*.ts",
  "apps/desktop/src/main/**/*.ts",
  "apps/desktop/src/preload/**/*.ts",
  "apps/desktop/src/drawing/**/*.ts",
  "apps/desktop/src/renderer/ui/**/*.{ts,tsx}",
  // The demo stage and component lab are code too, held to the same backstop.
  "apps/desktop/src/renderer/demo/**/*.{ts,tsx}",
];
const sourceLineBackstop = 1000;
const contractLineLimit = 300;

/*
 * A file that does one job past its limit gets a raise here, with a reason
 * naming that job: why its parts change together and splitting it would not
 * be coherent. "It grew" is not a reason. Whoever adds a responsibility to a
 * raised file re-reads its reason.
 */
const CEILING_RAISES = {};

for (const [path, { max, reason }] of Object.entries(CEILING_RAISES)) {
  const limit = path.startsWith("packages/contract/")
    ? contractLineLimit
    : sourceLineBackstop;
  if (!(max > limit) || typeof reason !== "string" || !reason.trim())
    throw new Error(
      `The ceiling raise for ${path} must exceed ${limit} lines and name the file's single job.`,
    );
}

export { sourceLineBackstop, contractLineLimit };

/*
 * The core rule's message says only that the file is too long, which reads as
 * "split it". ESLint publishes its core rules only through this entry point.
 */
const coreMaxLines = builtinRules.get("max-lines");
const responsibilityLines = {
  ...coreMaxLines,
  meta: {
    ...coreMaxLines.meta,
    messages: {
      exceed:
        "This file has {{actual}} lines of code; its ceiling is {{max}}. Review what this file is responsible for. Split it only where its responsibilities part. If it does one job and splitting it would not be coherent, raise this file's ceiling in CEILING_RAISES with the reason (docs/tooling.md).",
    },
  },
};
const zhiyin = { rules: { "max-lines": responsibilityLines } };

const lineLimit = (max) => [
  "error",
  { max, skipBlankLines: true, skipComments: true },
];

/*
 * The renderer's modules are read from the folders themselves, so a folder
 * added under `ui/` is held to the same rules the moment it exists. A list
 * kept by hand would fall behind and leave new modules unguarded.
 */
const renderer = "apps/desktop/src/renderer";

const codeFilesIn = (directory) =>
  entriesOf(directory)
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => `${directory}/${entry.name}`);

/** Whether anything under a folder is code, at any depth. */
const holdsCode = (directory) =>
  entriesOf(directory).some((entry) =>
    entry.isDirectory()
      ? holdsCode(`${directory}/${entry.name}`)
      : /\.tsx?$/.test(entry.name),
  );

const uiFolders = foldersIn(`${renderer}/ui`);
const rendererModules = uiFolders.filter(
  (name) => name !== "app" && name !== "shared",
);
const uiFolder = (name) => `${renderer}/ui/${name}`;

/** Every place in the renderer that can import something. */
const rendererPlaces = [
  ...uiFolders.map(uiFolder),
  // Every other folder in the renderer that holds code - the demo, and
  // anything added beside it - so a new one is held to the same entry points
  // the day it appears. A folder of images imports nothing and is not one.
  ...foldersIn(renderer)
    .filter((name) => name !== "ui" && holdsCode(`${renderer}/${name}`))
    .map((name) => `${renderer}/${name}`),
  ...codeFilesIn(renderer),
  ...codeFilesIn(`${renderer}/ui`),
  // Code beside the renderer, such as tests that draw its components, is held
  // to the same entry points as the renderer itself.
  ...codeFilesIn("apps/desktop/src"),
];
const placesExcept = (...excluded) =>
  rendererPlaces.filter((place) => !excluded.includes(place));

const rendererZones = [
  // A folder is used through its entry point. What it does not export is its
  // own business, and can change without anyone else noticing.
  ...uiFolders.map((name) => ({
    target: placesExcept(uiFolder(name)),
    from: uiFolder(name),
    except: ["./index.ts"],
    message: `Use ${name} through its index.ts. Everything else in it is private.`,
  })),
  // Modules meet only in the app shell, which passes one module's pieces into
  // another. A module that imports another has made that decision for it.
  ...rendererModules.map((name) => ({
    target: uiFolder(name),
    from: placesExcept(uiFolder(name), uiFolder("shared")),
    message:
      "A module does not import another module, the app shell, or the demo. The app shell composes modules and passes in what one needs from another.",
  })),
  {
    target: uiFolder("shared"),
    from: placesExcept(uiFolder("shared")),
    message:
      "Shared presentation holds neutral pieces and cannot depend on a module or the app shell.",
  },
  {
    target: renderer,
    from: ["apps/desktop/src/main", "apps/desktop/src/preload"],
    message:
      "The window reaches the core through the preload bridge, never by importing the main process or the bridge itself.",
  },
];

const rendererPackageRule = [
  "error",
  {
    patterns: [
      {
        group: ["@zhiyin/*", "!@zhiyin/contract"],
        message:
          "The renderer reaches the core through the preload bridge, not by importing backend packages.",
      },
    ],
    paths: [
      {
        name: "electron",
        message:
          "The renderer has no Node or Electron access. Everything it can do comes through the preload bridge.",
      },
    ],
  },
];

/**
 * TypeScript has no equivalent of a private module boundary, so the boundaries
 * the architecture depends on are enforced here instead. These rules are not
 * style: each one stands in for something a compiler would have caught.
 */
export default tseslint.config(
  // Evaluation fixtures are inputs, not source. One of them contains a
  // deliberate defect that the tooling must not tidy away, and they are written
  // in whatever style their case calls for. The trailer's production material
  // is kept out of the repository and holds third-party code.
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/node_modules/**",
      "evaluation/**",
      "trailer/**",
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    plugins: { "import-x": importX },
    settings: {
      "import-x/extensions": [".ts", ".tsx", ".js", ".mjs"],
      // Source imports name the `.js` file TypeScript will emit. Without this
      // alias the path rules cannot find the `.ts` file behind the name, and a
      // rule that cannot resolve an import silently allows it.
      "import-x/resolver-next": [
        createNodeResolver({
          extensions: [".ts", ".tsx", ".js", ".mjs", ".json"],
          extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
        }),
      ],
    },
    rules: {
      // Reaching into another package's internals. The closest thing we have
      // to "this item is private".
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@zhiyin/*/src/*", "@zhiyin/*/dist/*"],
              message:
                "Import a package by its name only. Its entry point is its public interface; everything else is internal.",
            },
          ],
        },
      ],
      // A relative path that climbs out into a sibling package is the same
      // violation wearing a different hat.
      "import-x/no-relative-packages": "error",
      // The layer rules stop a cycle between packages. Inside one package
      // this rule does, and a cycle there is the first sign two files are one.
      "import-x/no-cycle": "error",
    },
  },

  ...packageLayerRules,

  {
    /*
     * The layer rules read import declarations, so a package named any other
     * way is a package they cannot see: a dynamic import, a type named inline,
     * or a name handed to a runtime require would each reach whatever the
     * layer forbids, and report nothing. The contract is the one package every
     * package may name.
     */
    files: ["packages/*/src/**/*.{ts,tsx}", "apps/desktop/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value=/^@zhiyin\\/(?!contract)/]",
          message:
            "Import a workspace package with a static import, so the layer rules can see it.",
        },
        {
          selector:
            "TSImportType[argument.literal.value=/^@zhiyin\\/(?!contract)/]",
          message:
            "Name another package's type through a top-level `import type`, so the layer rules can see it.",
        },
        {
          selector:
            "CallExpression[arguments.0.value=/^@zhiyin\\/(?!contract)/]",
          message:
            "A workspace package required at runtime escapes the layer rules. Import it instead.",
        },
      ],
    },
  },

  {
    // The main process and the preload bridge carry messages between the
    // window and the core. The composition root is the one file that says
    // which implementation each part uses; nothing else here needs to import
    // what decides anything.
    files: [
      "apps/desktop/src/main/**/*.ts",
      "apps/desktop/src/preload/**/*.ts",
    ],
    ignores: ["apps/desktop/src/main/composition.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@zhiyin/*", "!@zhiyin/contract"],
              message:
                "The main process and preload carry messages only. Construct parts in the composition root and put decisions in the core.",
            },
          ],
        },
      ],
    },
  },

  {
    // The window draws; the main process and the bridge carry messages. What
    // the window is made of is none of their business.
    files: [
      "apps/desktop/src/main/**/*.ts",
      "apps/desktop/src/preload/**/*.ts",
    ],
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: repositoryRoot,
          zones: [
            {
              target: ["apps/desktop/src/main", "apps/desktop/src/preload"],
              from: renderer,
              message:
                "The main process and the bridge carry messages; they do not import the window's own code.",
            },
          ],
        },
      ],
    },
  },

  {
    // The drawing process runs the document viewer's drawing service and
    // nothing else (ADR 0018): it reaches no other part of the app, the main
    // process, or the window.
    files: ["apps/desktop/src/drawing/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@zhiyin/*", "!@zhiyin/document-viewer"],
              message:
                "The drawing process runs the document viewer's drawing service only.",
            },
          ],
        },
      ],
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: repositoryRoot,
          zones: [
            {
              target: "apps/desktop/src/drawing",
              from: [
                renderer,
                "apps/desktop/src/main",
                "apps/desktop/src/preload",
              ],
              message:
                "The drawing process imports nothing from the main process, the bridge or the window.",
            },
          ],
        },
      ],
    },
  },

  {
    files: [
      "apps/desktop/src/main/**/*.ts",
      "apps/desktop/src/drawing/**/*.ts",
      "packages/**/*.ts",
    ],
    languageOptions: { globals: globals.node },
  },

  {
    // Real programs a test starts as its own process, so that containment can
    // be proved against processes rather than against a fake.
    files: ["packages/**/test/fixtures/**/*.{mjs,mts}"],
    languageOptions: { globals: globals.node },
  },

  {
    // Gate scripts are Node programs that report to a terminal, so writing to
    // one is the point rather than a leftover debug line.
    files: ["scripts/**/*.{js,mjs}"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },

  {
    files: [`${renderer}/**/*.{ts,tsx}`],
    languageOptions: { globals: globals.browser },
    ...reactHooks.configs.flat["recommended-latest"],
    rules: {
      ...reactHooks.configs.flat["recommended-latest"].rules,
      // The renderer talks to the core through the preload bridge, never by
      // importing backend code or Electron directly.
      "no-restricted-imports": rendererPackageRule,
      "import-x/no-restricted-paths": [
        "error",
        { basePath: repositoryRoot, zones: rendererZones },
      ],
    },
  },

  {
    files: SOURCE_FILES,
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    plugins: { zhiyin },
    rules: { "zhiyin/max-lines": lineLimit(sourceLineBackstop) },
  },
  {
    // The contract is read by both sides of every boundary, so a file of it
    // is held well under the general limit.
    files: ["packages/contract/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: { "zhiyin/max-lines": lineLimit(contractLineLimit) },
  },
  {
    // A package's entry point is its public interface, so it lists what is
    // public and holds no implementation. Code placed there is imported back
    // from it by its neighbours, which is how a cycle starts.
    files: ["packages/*/src/index.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          "VariableDeclaration",
          "FunctionDeclaration",
          "ClassDeclaration",
          "TSTypeAliasDeclaration",
          "TSInterfaceDeclaration",
          "TSEnumDeclaration",
          "ExportDefaultDeclaration",
          "ExportNamedDeclaration[declaration]",
        ].map((kind) => ({
          selector: `Program > ${kind}`,
          message:
            "index.ts only re-exports. Put the declaration in a file named for what it is and export it from here.",
        })),
      ],
    },
  },
  ...Object.entries(CEILING_RAISES).map(([path, { max }]) => ({
    files: [path],
    rules: { "zhiyin/max-lines": lineLimit(max) },
  })),

  prettier,
);
