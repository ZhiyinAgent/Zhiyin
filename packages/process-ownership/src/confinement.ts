/**
 * Confinement: a program started in an app container reaches only the
 * folders it is given, and the internet only when asked. Its user folder,
 * application data and temporary files are in a home of the run's own, and
 * each home has a container of its own, so nothing one run leaves reaches a
 * run given another home.
 */

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, parse, resolve } from "node:path";
import {
  containerFor,
  internetCapability,
  removeContainer,
  securityCapabilities,
} from "./app-container.js";
import { grantFolders } from "./folder-grants.js";

export type Confinement = {
  /**
   * What the program is for, such as `latex`: lowercase letters, digits and
   * dashes. Runs for one purpose and one home share an app container.
   */
  readonly purpose: string;
  /**
   * The run's own folder, standing in for the person's user folder: the
   * program keeps its settings, application data and temporary files there.
   * Made if it is not there, and the program may change it.
   */
  readonly home: string;
  /** Folders it may read, with everything in them. */
  readonly read: readonly string[];
  /** Folders it may read and change, with everything in them. */
  readonly write: readonly string[];
  /** Whether it may reach the internet. */
  readonly network: boolean;
};

declare const made: unique symbol;

/** A confinement whose folders are granted, ready to start a process in. */
export type Confined = {
  readonly purpose: string;
  readonly [made]: true;
};

type Identity = {
  readonly container: string;
  readonly capabilities: readonly string[];
  /** What the program's environment says in place of the person's folders. */
  readonly environment: Readonly<Record<string, string>>;
};

const identities = new WeakMap<object, Identity>();
const purposes = /^[a-z][a-z0-9-]{0,30}$/;

/**
 * The container a home's runs share. Windows gives each container a folder
 * of its own in the person's profile, which it may change, and storage in the
 * registry; a container per home keeps those apart as the homes are.
 */
function containerName(purpose: string, home: string): string {
  const key = createHash("sha256")
    .update(resolve(home).toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return `Zhiyin.${purpose}.${key}`;
}

/** Purposes whose container from before homes had their own is gone. */
const sharedRemoved = new Set<string>();

/**
 * Removes the container a home's runs share, once its home is removed for
 * good, so the person's profile keeps no container for a home that is gone.
 * Its next run, if any, has a new one.
 */
export function forgetConfinement(purpose: string, home: string): void {
  if (purposes.test(purpose)) removeContainer(containerName(purpose, home));
}

/**
 * Grants the folders a confinement names, makes its home, and registers its
 * purpose's profile on first use. Rejects, saying why, when a folder may not
 * or cannot be given.
 */
export async function confine(confinement: Confinement): Promise<Confined> {
  if (!purposes.test(confinement.purpose))
    throw new Error(
      `"${confinement.purpose}" cannot name a purpose: use lowercase letters, digits and dashes.`,
    );
  // The one container all runs of a purpose once shared goes, with what was
  // left in its folder.
  if (!sharedRemoved.has(confinement.purpose)) {
    sharedRemoved.add(confinement.purpose);
    removeContainer(`Zhiyin.${confinement.purpose}`);
  }
  const home = resolve(confinement.home);
  const name = containerName(confinement.purpose, home);
  const container = containerFor(name);
  const local = join(home, "AppData", "Local");
  // Windows gives a container process the local application data and the
  // temporary folder of its profile below the local application data it is
  // given, and finds the person's folders from the user folder it is given;
  // each must be there.
  await mkdir(join(home, "AppData", "Roaming"), { recursive: true });
  await mkdir(join(local, "Packages", name, "AC", "Temp"), { recursive: true });
  const writes = [...new Set([home, ...confinement.write])];
  const reads = [...new Set(confinement.read)].filter(
    (folder) => !writes.includes(folder),
  );
  const capabilities = await grantFolders([
    ...writes.map((folder) => ({ folder, access: "write" as const })),
    ...reads.map((folder) => ({ folder, access: "read" as const })),
  ]);
  const drive = parse(home).root.replace(/\\$/, "");
  const confined = { purpose: confinement.purpose } as Confined;
  identities.set(confined, {
    container,
    capabilities: [
      ...new Set(capabilities),
      ...(confinement.network ? [internetCapability] : []),
    ],
    environment: {
      USERPROFILE: home,
      HOMEDRIVE: drive,
      HOMEPATH: home.slice(drive.length),
      APPDATA: join(home, "AppData", "Roaming"),
      LOCALAPPDATA: local,
    },
  });
  return confined;
}

/**
 * The environment a confined process is started with: the one asked for, with
 * the confinement's own folders in place of the person's. Windows sets
 * TEMP and TMP itself, below the local application data.
 */
export function confinedEnvironment(
  confined: Confined,
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const own = identityOf(confined).environment;
  const replaced = new Set(
    [...Object.keys(own), "TEMP", "TMP"].map((name) => name.toUpperCase()),
  );
  return {
    ...Object.fromEntries(
      Object.entries(environment).filter(
        ([name]) => !replaced.has(name.toUpperCase()),
      ),
    ),
    ...own,
  };
}

/** The attribute that starts a process in the confinement's container. */
export function confinedStart(confined: Confined) {
  const identity = identityOf(confined);
  return securityCapabilities(identity.container, identity.capabilities);
}

function identityOf(confined: Confined): Identity {
  const identity = identities.get(confined);
  if (!identity)
    throw new Error("A process can be confined only as confine() prepared it.");
  return identity;
}
