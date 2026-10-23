import type { ConnectionTool } from "@zhiyin/contract";

const environmentChoice = {
  type: "string",
  description:
    "The environment, by name. Without it, the default one, which has pandas, polars, NumPy, SciPy, Matplotlib, seaborn, statsmodels and openpyxl.",
} as const;

const packages = {
  type: "array",
  items: { type: "string" },
  description:
    "Package names from pypi.org, optionally with a version specifier, such as plotly or numpy<2.",
} as const;

export const tools: readonly ConnectionTool[] = [
  {
    name: "run_python",
    description:
      "Run a Python script in one of Zhiyin's Python environments, with the workspace folder as its working directory. Give either code to run or the path of a script in the workspace. The script reads and changes only files in the workspace: a file kept elsewhere has to be copied in first. To discard a program's output, use subprocess.DEVNULL or os.devnull; a shell's own '> nul' is refused there.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Python source to run." },
        path: {
          type: "string",
          description: "Workspace-relative path of a .py file to run instead.",
        },
        arguments: {
          type: "array",
          items: { type: "string" },
          description: "Command-line arguments for the script.",
        },
        network: {
          type: "boolean",
          description:
            "Let the script use the internet. Without it, the script reaches only the workspace, and running such scripts is approved once per conversation.",
        },
        environment: environmentChoice,
      },
      additionalProperties: false,
    },
  },
  {
    name: "install_python_package",
    description:
      "Add packages to one of Zhiyin's Python environments with its own pip. This changes only that environment, never a project's own.",
    inputSchema: {
      type: "object",
      properties: {
        packages: { ...packages, minItems: 1 },
        environment: environmentChoice,
      },
      required: ["packages"],
      additionalProperties: false,
    },
  },
  {
    name: "create_python_environment",
    description:
      "Create a Python environment of its own, for work that needs another Python version or packages that would clash with the default environment's. Environments are kept between conversations until removed.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Up to 32 lowercase letters, digits and dashes, starting with a letter.",
        },
        python: {
          type: "string",
          description: "The Python version, such as 3.12. Without it, 3.13.",
        },
        packages,
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "list_python_environments",
    description:
      "List Zhiyin's Python environments, with the Python version and the packages installed in each.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "remove_python_environment",
    description:
      "Delete one of Zhiyin's Python environments and everything installed in it. The default environment is reset instead.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The environment's name." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "reset_python_environment",
    description:
      "Delete one of Zhiyin's Python environments and build it again with the Python and packages it was made with. Packages added to it since are lost.",
    inputSchema: {
      type: "object",
      properties: { environment: environmentChoice },
      additionalProperties: false,
    },
  },
];
