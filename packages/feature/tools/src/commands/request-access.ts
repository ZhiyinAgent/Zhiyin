/**
 * `request_access`: the model asks for its sealed-off commands to reach a
 * website or a folder beyond the workspace (ADR 0029). The card is built from
 * what Zhiyin checked itself, the website's registrable domain or exact host,
 * or the folder's whole real path and whether it is read or changed; the
 * model's reason is shown as its claim. It is asked every time. What the
 * person allows is kept by the agent loop as a grant for the conversation.
 */

import type { ToolCallInspection, ToolSpec } from "@zhiyin/contract";
import { schemaInput, withSchemaProblems } from "@zhiyin/tool-input";
import type { ToolDefinition } from "../tool-definition.js";
import { effectsOf } from "../shared/effects.js";
import { describeCommand } from "../shared/workspace-path.js";
import { checkedFolder, checkedWebsite } from "./reach.js";

const maximumReason = 400;

const spec: ToolSpec = {
  name: "request_access",
  description: [
    "Ask the person to let this conversation's sealed-off commands reach one website or one folder more, for the rest of the conversation. Ask only when a command needs it: a command was refused a host, or a folder outside the workspace.",
    "A website is granted by its registrable domain, which covers every name below it, such as api.example.com under example.com; or by one exact host with exact: true. Port 443 unless port says another. A folder is granted by its whole path, to read or to change.",
    "Never granted: an address, a name of this computer, a public suffix, a cloud storage or delivery domain shared by many; a drive, the user folder or a folder holding it, a network share, Zhiyin's own folders and where credentials are kept; and, to change, Windows, Program Files and Startup folders. A folder holding a link leading out of it is refused.",
    "If the person declines, do not ask for the same again; three declined requests in a row end the turn.",
  ].join("\n\n"),
  inputSchema: {
    type: "object",
    properties: {
      host: {
        type: "string",
        maxLength: 253,
        description:
          "A website's name, such as example.com, with no scheme, port or path. Give host or folder, not both.",
      },
      exact: {
        type: "boolean",
        description:
          "With host: grant that one host only, not every name below its registrable domain.",
      },
      port: {
        type: "integer",
        minimum: 1,
        maximum: 65535,
        description: "With host: the port, when it is not 443.",
      },
      folder: {
        type: "string",
        maxLength: 1000,
        description: "A folder's whole path, from its drive.",
      },
      access: {
        type: "string",
        enum: ["read", "change"],
        description:
          "With folder: whether commands may only read it, or also change it.",
      },
      purpose: {
        type: "string",
        maxLength: maximumReason,
        description:
          "One plain sentence for the person: why the work needs it. It is shown as your words.",
      },
    },
    required: ["purpose"],
    additionalProperties: false,
  },
};

type Asked = {
  readonly host?: string;
  readonly exact?: boolean;
  readonly port?: number;
  readonly folder?: string;
  readonly access?: "read" | "change";
  readonly purpose: string;
};

function refusal(reason: string): ToolCallInspection {
  return { ok: false, correctable: true, reason };
}

async function inspect(
  args: unknown,
  root: string | undefined,
  protect: readonly string[],
): Promise<ToolCallInspection> {
  const input = schemaInput<Asked>(spec.inputSchema, args);
  if (!input || !input.purpose.trim())
    return refusal(
      withSchemaProblems(
        "Name a host or a folder, and say why in purpose.",
        args,
        spec.inputSchema,
      ),
    );
  const claim = input.purpose.trim().replace(/\s+/g, " ");
  if ((input.host === undefined) === (input.folder === undefined))
    return refusal("Name one host or one folder in each request, not both.");
  if (input.host !== undefined) {
    if (input.access !== undefined)
      return refusal(
        "access goes with a folder; a website is reached, not read or changed.",
      );
    const site = checkedWebsite(input.host, input.exact === true, input.port);
    if (!site.ok) return refusal(site.reason);
    return {
      ok: true,
      action: "Let commands reach a website",
      target: site.label,
      claim,
      detail: `Sealed-off commands in this conversation may connect to ${site.label}, over HTTPS through Zhiyin, until the conversation ends or you take it back.`,
      asksEachTime: true,
      effects: effectsOf({}),
      grants: { kind: "website", label: site.label, hosts: site.hosts },
      command: describeCommand(spec.name, {
        host: site.site,
        exact: input.exact === true,
        port: input.port,
      }),
      invocation: {
        name: "Let commands reach a website",
        arguments: [{ name: "Website", value: site.label, readable: true }],
      },
    };
  }
  if (input.port !== undefined || input.exact !== undefined)
    return refusal("port and exact go with a host, not a folder.");
  if (input.access === undefined)
    return refusal(
      "Say whether commands may read the folder or also change it, as access.",
    );
  const checked = await checkedFolder(
    input.folder as string,
    input.access,
    protect,
    root,
  );
  if (!checked.ok) return refusal(checked.reason);
  const changing = input.access === "change";
  return {
    ok: true,
    action: changing
      ? "Let commands change a folder"
      : "Let commands read a folder",
    target: checked.folder,
    claim,
    detail: changing
      ? `Sealed-off commands in this conversation may read and change every file in ${checked.folder}, outside the folder you selected, until the conversation ends or you take it back. Each change is saved first, so going back undoes it.`
      : `Sealed-off commands in this conversation may read every file in ${checked.folder}, outside the folder you selected, until the conversation ends or you take it back. What they read could then be sent to the websites the conversation reaches.`,
    asksEachTime: true,
    // What the folder holds comes within the conversation's reach.
    effects: effectsOf({ reads: "elsewhere" }),
    grants: { kind: "folder", folder: checked.folder, access: input.access },
    command: describeCommand(spec.name, {
      folder: checked.folder,
      access: input.access,
    }),
    invocation: {
      name: changing
        ? "Let commands change a folder"
        : "Let commands read a folder",
      arguments: [
        { name: "Folder", value: checked.folder, readable: true },
        {
          name: "Access",
          value: changing ? "Read and change" : "Read only",
          readable: true,
        },
      ],
    },
  };
}

/** The tool, as the registry offers it. */
export function requestAccessTool(protect: readonly string[]): ToolDefinition {
  return {
    spec,
    requiresWorkspace: true,
    requiresShell: true,
    requiresSealedShell: true,
    inspect: (args, _conversationId, folder) =>
      inspect(args, folder.available ? folder.root : undefined, protect),
    // Checked again as it runs: a link put in the folder since is refused.
    execute: async (args, _signal, _conversationId, folder) => {
      const again = await inspect(
        args,
        folder.available ? folder.root : undefined,
        protect,
      );
      if (!again.ok) return { ok: false, reason: again.reason };
      return {
        ok: true,
        value: {
          granted: again.target,
          note: "The person allowed it for this conversation. Run the command again.",
        },
      };
    },
  };
}
