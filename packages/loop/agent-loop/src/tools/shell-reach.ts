/**
 * What a conversation granted its sealed-off commands, kept as its grants
 * (ADR 0029): a website, a folder to read, a folder to change, and whether
 * the package registries stay on the list. Each grant holds the
 * conversation's two facts (ADR 0012) as its card stated them; one the
 * conversation has outgrown is confirmed before a command reaches it.
 */

import type {
  AccessGrant,
  ConversationPermission,
  WorkspaceTask,
} from "@zhiyin/contract";
import type { ConversationFacts } from "@zhiyin/permission-engine";

/** What sealed-off commands reach beyond the workspace, as the tools read it. */
export type ShellReach = {
  readonly hosts: readonly string[];
  readonly read: readonly string[];
  readonly change: readonly string[];
  readonly registries: boolean;
};

type Grant = Omit<ConversationPermission, "id" | "at">;

/** Whether a grant was made for sealed-off commands, in the folder they work in now. */
function forCommands(
  permission: ConversationPermission,
  root: string | undefined,
): boolean {
  return (
    permission.facts !== undefined &&
    (permission.kind === "reach-host" ||
      permission.kind === "reach-folder" ||
      permission.kind === "outside-folder") &&
    // A grant does not carry to another folder the conversation moves to.
    (permission.workspaceRoot === undefined ||
      root === undefined ||
      permission.workspaceRoot.toLowerCase() === root.toLowerCase())
  );
}

/** What the conversation's grants let its sealed-off commands reach. */
export function shellReach(
  task: Pick<WorkspaceTask, "conversationPermissions">,
  root: string | undefined,
): ShellReach {
  const granted = task.conversationPermissions.filter((permission) =>
    forCommands(permission, root),
  );
  return {
    hosts: granted.flatMap((permission) =>
      permission.kind === "reach-host" ? (permission.hosts ?? []) : [],
    ),
    read: granted.flatMap((permission) =>
      permission.kind === "reach-folder" && permission.folder
        ? [permission.folder]
        : [],
    ),
    change: granted.flatMap((permission) =>
      permission.kind === "outside-folder" && permission.folder
        ? [permission.folder]
        : [],
    ),
    registries: !task.conversationPermissions.some(
      (permission) =>
        permission.kind === "reach-registries" && permission.declined,
    ),
  };
}

/** Whether the conversation holds a fact the card did not cover. */
function outgrown(
  stated: NonNullable<ConversationPermission["facts"]>,
  now: ConversationFacts,
): boolean {
  return (
    (now.outsideContent && !stated.outsideContent) ||
    (now.privateWithinReach && !stated.privateWithinReach)
  );
}

/** What confirming the conversation's reach is about. */
export type ReachToConfirm = {
  /** Each grant the conversation has outgrown. */
  readonly grants: readonly ConversationPermission[];
  /** Whether the package registries are to be confirmed. */
  readonly registries: boolean;
};

/**
 * The grants a sealed-off command could reach whose facts the conversation
 * has outgrown; and the package registries once outside content and
 * something private meet, until the person confirmed or declined them.
 */
export function reachToConfirm(
  task: Pick<WorkspaceTask, "conversationPermissions">,
  root: string | undefined,
  facts: ConversationFacts,
): ReachToConfirm | undefined {
  const grants = task.conversationPermissions.filter(
    (permission) =>
      forCommands(permission, root) && outgrown(permission.facts!, facts),
  );
  const answered = task.conversationPermissions.find(
    (permission) => permission.kind === "reach-registries",
  );
  const registries =
    facts.outsideContent &&
    facts.privateWithinReach &&
    (!answered || (!answered.declined && outgrown(answered.facts!, facts)));
  return grants.length || registries ? { grants, registries } : undefined;
}

/** The registries as the person confirmed or declined them, with the facts then. */
export function registriesAnswer(
  facts: ConversationFacts,
  declined: boolean,
): Grant {
  return {
    kind: "reach-registries",
    label: "Package registries and Git hosts",
    toolName: "bash",
    facts: {
      outsideContent: facts.outsideContent,
      privateWithinReach: facts.privateWithinReach,
    },
    ...(declined ? { declined: true as const } : {}),
  };
}

/** The grant a request the person allowed makes, with the facts its card stated. */
export function accessGrant(
  grants: AccessGrant,
  facts: ConversationFacts,
  root: string | undefined,
): Grant {
  const stated = {
    facts: {
      outsideContent: facts.outsideContent,
      privateWithinReach: facts.privateWithinReach,
    },
    toolName: "bash",
    ...(root ? { workspaceRoot: root } : {}),
  };
  if (grants.kind === "website")
    return {
      ...stated,
      kind: "reach-host",
      label: `Commands may reach ${grants.label}`,
      hosts: grants.hosts,
    };
  return grants.access === "read"
    ? {
        ...stated,
        kind: "reach-folder",
        label: `Commands may read ${grants.folder}`,
        folder: grants.folder,
      }
    : {
        ...stated,
        kind: "outside-folder",
        label: `Commands may change ${grants.folder}`,
        folder: grants.folder,
      };
}

/**
 * What a website's card says it lets out (ADR 0029): where something private
 * is within reach, that what the conversation can read could be sent to
 * anyone who uses the website; otherwise, that commands may download from it.
 */
export function websiteDetail(label: string, facts: ConversationFacts): string {
  return facts.privateWithinReach
    ? `Commands in this conversation may connect to ${label} until the conversation ends or you take it back. Something private is within this conversation's reach, so what the conversation can read could be sent to anyone who uses that website: Zhiyin sees which website a command reaches, never what it sends.`
    : `Commands in this conversation may connect to ${label} and download from it, until the conversation ends or you take it back. Nothing private is within this conversation's reach yet; if that changes, you are asked again.`;
}

/**
 * What the card confirming the conversation's reach says: each place it
 * keeps or takes back, and what the conversation holds now that it did not
 * when they were allowed.
 */
export function confirmationDetail(
  confirm: ReachToConfirm,
  facts: ConversationFacts,
): {
  readonly places: readonly {
    readonly label: string;
    readonly kind: "website" | "folder";
  }[];
  readonly since: string;
} {
  const places = [
    ...confirm.grants.map((grant) => ({
      label: grant.label,
      kind:
        grant.kind === "reach-host"
          ? ("website" as const)
          : ("folder" as const),
    })),
    ...(confirm.registries
      ? [
          {
            label:
              "Commands may reach the package registries and Git hosts Zhiyin lists",
            kind: "website" as const,
          },
        ]
      : []),
  ];
  const one = places.length === 1;
  const there = one ? "this place" : "these places";
  const since =
    facts.outsideContent && facts.privateWithinReach
      ? `This conversation has now read content from outside, and something private is within reach: a command could send what it reads to ${there}, or download something that steers the work.`
      : facts.outsideContent
        ? `This conversation has now read content from outside: what a command downloads from ${there} could steer the work.`
        : `Something private is now within this conversation's reach: a command could send what it reads to ${there}.`;
  return { places, since };
}
