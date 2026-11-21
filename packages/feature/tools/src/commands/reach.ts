/**
 * What a conversation's sealed-off commands reach beyond the workspace, and
 * the checks a request for more passes before anyone is asked (ADR 0029): a
 * website by its registrable domain, by the Public Suffix List, or one exact
 * host; a folder by its whole real path, for reading or for changing. What
 * may never be granted is refused before a card.
 */

import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { domainToASCII } from "node:url";
import { parse } from "tldts";
import { mayGrantFolder } from "@zhiyin/sandbox";
import { holds, startupFolders } from "@zhiyin/workspace-containment";

/** What the conversation granted its sealed-off commands, as the agent loop keeps it. */
export type ShellReach = {
  /** The hosts of each website granted, as a confinement names them. */
  readonly hosts: readonly string[];
  /** Folders granted for reading, by real path. */
  readonly read: readonly string[];
  /** Folders granted for changing, by real path. */
  readonly change: readonly string[];
  /** Whether the package registries and Git hosts Zhiyin lists are on the list. */
  readonly registries: boolean;
};

/** A conversation's reach, read as each command is looked at and run. */
export type ConversationReach = (conversationId: string) => ShellReach;

/** What a conversation reaches when nothing was granted to it. */
export const nothingGranted: ShellReach = {
  hosts: [],
  read: [],
  change: [],
  registries: true,
};

/**
 * The package registries, with the hosts that keep their files, and the Git
 * hosting sites Zhiyin lists: on every conversation's list until outside
 * content and something private meet, then confirmed like any grant.
 */
export const packageRegistries: readonly string[] = [
  "registry.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "index.crates.io",
  "static.crates.io",
  "github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
  "gitlab.com",
  "bitbucket.org",
  "codeberg.org",
];

/**
 * Domains so many unrelated people store files under that a grant would
 * name no one website: cloud storage and delivery networks.
 */
const sharedDomains = [
  "amazonaws.com",
  "cloudfront.net",
  "akamaihd.net",
  "akamaized.net",
  "azureedge.net",
  "azurefd.net",
  "core.windows.net",
  "googleapis.com",
  "googleusercontent.com",
  "githubusercontent.com",
  "fastly.net",
  "fastlylb.net",
  "cloudflare.net",
  "cloudflarestorage.com",
  "digitaloceanspaces.com",
  "b-cdn.net",
  "backblazeb2.com",
];

/** Names that mean this computer or its own network. */
const localNames =
  /(^|\.)(localhost|local|lan|home|internal|intranet|corp|home\.arpa)$/;

export type WebsiteChecked =
  | {
      readonly ok: true;
      readonly label: string;
      readonly hosts: readonly string[];
      /** The registrable domain, or the exact host. */
      readonly site: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * A website as a grant names it: the registrable domain of `asked`, which
 * covers every name below it, or `asked` alone when `exact`. Port 443 unless
 * another is named.
 */
export function checkedWebsite(
  asked: string,
  exact: boolean,
  port: number | undefined,
): WebsiteChecked {
  const text = asked.trim();
  if (!text || /[/?#@\s:\\[\]]/.test(text) || text.includes("*"))
    return {
      ok: false,
      reason: `“${asked}” is not a host: name it alone, such as example.com, with no scheme, port, path or wildcard. A port goes in port.`,
    };
  const host = domainToASCII(text.replace(/\.$/, "")).toLowerCase();
  if (!host || isIP(host))
    return {
      ok: false,
      reason: `“${asked}” is not a website's name. An address cannot be granted: name the website.`,
    };
  if (!host.includes(".") || localNames.test(host))
    return {
      ok: false,
      reason: `${host} is a name of this computer or its network, which commands never reach.`,
    };
  const parsed = parse(host, { allowPrivateDomains: true });
  if (!parsed.domain || !parsed.publicSuffix || parsed.hostname !== host)
    return {
      ok: false,
      reason: `${host} is a public suffix, under which anyone can have a name: name the website itself.`,
    };
  const shared = sharedDomains.find(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (shared)
    return {
      ok: false,
      reason: `${host} is under ${shared}, where many unrelated people keep files, so it names no one website.`,
    };
  if (
    port !== undefined &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  )
    return { ok: false, reason: `Port ${port} does not exist.` };
  const suffix = port === undefined || port === 443 ? "" : `:${port}`;
  const shownPort = suffix ? `, on port ${port}` : "";
  if (exact)
    return {
      ok: true,
      site: host,
      hosts: [`${host}${suffix}`],
      label: `${host} only${shownPort}`,
    };
  return {
    ok: true,
    site: parsed.domain,
    hosts: [`${parsed.domain}${suffix}`, `*.${parsed.domain}${suffix}`],
    label: `${parsed.domain} and every name below it${shownPort}`,
  };
}

/**
 * Where people's credentials are kept, below their user folder: never
 * granted, nor is a folder holding one.
 */
function credentialStores(home: string): readonly string[] {
  const roaming = join(home, "AppData", "Roaming");
  const local = join(home, "AppData", "Local");
  return [
    join(home, ".ssh"),
    join(home, ".aws"),
    join(home, ".azure"),
    join(home, ".config", "gh"),
    join(home, ".git-credentials"),
    join(home, ".npmrc"),
    join(home, ".pypirc"),
    join(home, ".docker"),
    join(home, ".kube"),
    join(local, "Google", "Chrome", "User Data"),
    join(local, "Microsoft", "Edge", "User Data"),
    join(local, "BraveSoftware"),
    join(local, "Vivaldi"),
    join(roaming, "Mozilla", "Firefox"),
    join(roaming, "Opera Software"),
    join(roaming, "Microsoft", "Credentials"),
    join(local, "Microsoft", "Credentials"),
    join(roaming, "Microsoft", "Protect"),
    join(local, "Microsoft", "Vault"),
    join(roaming, "Microsoft", "Vault"),
    join(roaming, "GitHub CLI"),
    join(local, "1Password"),
    join(roaming, "1Password"),
    join(roaming, "Bitwarden"),
    join(roaming, "KeePass"),
    join(roaming, "KeePassXC"),
    join(local, "KeePassXC"),
    join(roaming, "Dashlane"),
    join(local, "LastPass"),
    join(roaming, "Enpass"),
    join(roaming, "Proton Pass"),
  ];
}

/** The most entries looked through for links before a folder is refused as too large. */
const mostEntries = 200_000;

export type FolderChecked =
  | { readonly ok: true; readonly folder: string }
  | { readonly ok: false; readonly reason: string };

/** Each entry below `folder`, stopped past the most looked through. */
async function linksAndNames(folder: string): Promise<
  | {
      readonly linksOut: readonly string[];
      readonly sharedNames: number;
    }
  | undefined
> {
  const linksOut: string[] = [];
  let sharedNames = 0;
  let looked = 0;
  const pending = [folder];
  while (pending.length) {
    const current = pending.pop()!;
    const entries = await readdir(current, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      looked += 1;
      if (looked > mostEntries) return undefined;
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(path).catch(() => undefined);
        if (!target || !holds(folder, target)) linksOut.push(path);
        continue;
      }
      if (entry.isDirectory()) {
        // A junction reads as a link; a mount point leads elsewhere too.
        const real = await realpath(path).catch(() => path);
        if (!holds(folder, real)) linksOut.push(path);
        else pending.push(path);
        continue;
      }
      if (entry.isFile()) {
        const status = await lstat(path).catch(() => undefined);
        if (status && status.nlink > 1) sharedNames += 1;
      }
    }
  }
  return { linksOut, sharedNames };
}

/**
 * A folder as a grant names it: its whole real path, there, reached through
 * no link, and none of what is never granted (ADR 0029). `protect` names
 * Zhiyin's own folders.
 */
export async function checkedFolder(
  asked: string,
  access: "read" | "change",
  protect: readonly string[],
  workspace: string | undefined,
): Promise<FolderChecked> {
  if (!isAbsolute(asked))
    return {
      ok: false,
      reason: `${asked} is not a whole path: name the folder from its drive, such as C:\\Projects\\data.`,
    };
  const named = resolve(asked);
  if (named.startsWith("\\\\"))
    return {
      ok: false,
      reason: `${named} is a network share, which is never granted.`,
    };
  const real = await realpath(named).catch(() => undefined);
  if (!real || !(await stat(real).catch(() => undefined))?.isDirectory())
    return { ok: false, reason: `${named} is not a folder that is there.` };
  if (real.toLowerCase() !== named.toLowerCase())
    return {
      ok: false,
      reason: `${named} leads elsewhere through a link: name the folder it leads to, ${real}.`,
    };
  if (workspace && holds(workspace, real))
    return {
      ok: false,
      reason: `${real} is in the workspace, which commands already reach.`,
    };
  const home = resolve(homedir());
  if (dirname(real) === real || holds(real, home))
    return {
      ok: false,
      reason: `${real} holds nearly everything on this PC, so it is never granted: name the folder the work needs.`,
    };
  if (workspace && holds(real, workspace))
    return {
      ok: false,
      reason: `${real} holds the workspace, so it is never granted: name the folder the work needs.`,
    };
  if (protect.some((own) => holds(own, real) || holds(real, own)))
    return {
      ok: false,
      reason: `${real} is or holds a folder Zhiyin keeps for itself, which is never granted.`,
    };
  const store = credentialStores(home).find(
    (each) => holds(each, real) || holds(real, each),
  );
  if (store)
    return {
      ok: false,
      reason: `${real} is or holds ${store}, where credentials are kept, which is never granted. A credential reaches a command only with full access.`,
    };
  if (access === "change") {
    const windows = process.env["SystemRoot"] ?? "C:\\Windows";
    const programs = [
      process.env["ProgramFiles"],
      process.env["ProgramFiles(x86)"],
      process.env["ProgramW6432"],
    ].filter((folder): folder is string => Boolean(folder));
    const kept = [windows, ...programs, ...startupFolders()].find(
      (each) => holds(each, real) || holds(real, each),
    );
    if (kept)
      return {
        ok: false,
        reason: `${real} is or holds ${kept}, which commands may read but never change.`,
      };
  }
  if (!mayGrantFolder(real))
    return {
      ok: false,
      reason: `${real} cannot be given to a container: only an administrator may change who opens it, as for Program Files and Windows' own folders. A program installed there that commands cannot reach runs only with full_access, which the person approves.`,
    };
  const walked = await linksAndNames(real);
  if (!walked)
    return {
      ok: false,
      reason: `${real} holds more than ${mostEntries.toLocaleString("en-US")} entries, too many to check for links out of it: name a folder inside it.`,
    };
  if (walked.linksOut.length)
    return {
      ok: false,
      reason: `${real} holds a link leading out of it, ${walked.linksOut[0]}, so it is not granted: a grant follows no link out of its folder.`,
    };
  if (walked.sharedNames)
    return {
      ok: false,
      reason: `${real} holds ${walked.sharedNames} file${walked.sharedNames === 1 ? "" : "s"} with more than one name, whose other names could be outside it, so it is not granted.`,
    };
  return { ok: true, folder: real };
}
