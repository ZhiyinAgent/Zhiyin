/**
 * Windows AppContainers: the profile a program runs in, the capabilities it
 * holds, and the block that starts a process inside one.
 *
 * A process started with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` runs
 * with the person's token turned into an app container token: Windows lets
 * it open a file only when the file's permissions name its container, a
 * capability it holds, or every app container, as Windows' own files do. The
 * container must be registered as a profile first, or the process is not
 * created.
 */

import koffi, { type TypeObject } from "koffi";
import { win32 } from "./kernel32.js";

/** The capability Windows names `internetClient`. */
export const internetCapability = "S-1-15-3-1";
const PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009;
const SE_GROUP_ENABLED = 0x00000004;
/** `HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)`. */
const alreadyExists = 0x800700b7 | 0;

type Userenv = {
  readonly createProfile: (name: string, out: unknown[]) => number;
  readonly deleteProfile: (name: string) => number;
  readonly deriveContainer: (name: string, out: unknown[]) => number;
  readonly deriveCapabilities: (
    name: string,
    groups: unknown[],
    groupCount: number[],
    sids: unknown[],
    sidCount: number[],
  ) => boolean;
  readonly sidText: (sid: unknown, out: unknown[]) => boolean;
  readonly sidFromText: (text: string, out: unknown[]) => boolean;
  readonly freeSid: (sid: unknown) => unknown;
  readonly localFree: (memory: unknown) => unknown;
  readonly capabilitiesType: TypeObject;
  readonly sidAndAttributesType: TypeObject;
};

let loaded: Userenv | undefined;

function userenv(): Userenv {
  if (loaded) return loaded;
  // Containment's own structures come first; these are declared beside them.
  win32();
  const kernel32 = koffi.load("kernel32.dll");
  const kernelbase = koffi.load("kernelbase.dll");
  const advapi32 = koffi.load("advapi32.dll");
  const library = koffi.load("userenv.dll");
  const sidAndAttributesType = koffi.struct("SID_AND_ATTRIBUTES", {
    Sid: "void*",
    Attributes: "uint32",
  });
  const capabilitiesType = koffi.struct("SECURITY_CAPABILITIES", {
    AppContainerSid: "void*",
    Capabilities: "void*",
    CapabilityCount: "uint32",
    Reserved: "uint32",
  });
  const CreateAppContainerProfile = library.func(
    "int32 CreateAppContainerProfile(const char16_t*, const char16_t*, const char16_t*, void*, uint32, _Out_ void**)",
  );
  const DeleteAppContainerProfile = library.func(
    "int32 DeleteAppContainerProfile(const char16_t*)",
  );
  const DeriveAppContainerSidFromAppContainerName = library.func(
    "int32 DeriveAppContainerSidFromAppContainerName(const char16_t*, _Out_ void**)",
  );
  const DeriveCapabilitySidsFromName = kernelbase.func(
    "bool DeriveCapabilitySidsFromName(const char16_t*, _Out_ void**, _Out_ uint32*, _Out_ void**, _Out_ uint32*)",
  );
  const ConvertSidToStringSidW = advapi32.func(
    "bool ConvertSidToStringSidW(void*, _Out_ void**)",
  );
  const ConvertStringSidToSidW = advapi32.func(
    "bool ConvertStringSidToSidW(const char16_t*, _Out_ void**)",
  );
  const FreeSid = advapi32.func("void* FreeSid(void*)");
  const LocalFree = kernel32.func("void* LocalFree(void*)");
  loaded = {
    createProfile: (name, out) =>
      CreateAppContainerProfile(
        name,
        `Zhiyin ${name}`,
        "A program Zhiyin runs on files and code it was given.",
        null,
        0,
        out,
      ),
    deleteProfile: (name) => DeleteAppContainerProfile(name),
    deriveContainer: (name, out) =>
      DeriveAppContainerSidFromAppContainerName(name, out),
    deriveCapabilities: (name, groups, groupCount, sids, sidCount) =>
      DeriveCapabilitySidsFromName(name, groups, groupCount, sids, sidCount),
    sidText: (sid, out) => ConvertSidToStringSidW(sid, out),
    sidFromText: (text, out) => ConvertStringSidToSidW(text, out),
    freeSid: (sid) => FreeSid(sid),
    localFree: (memory) => LocalFree(memory),
    capabilitiesType,
    sidAndAttributesType,
  };
  return loaded;
}

function textOf(api: Userenv, sid: unknown): string {
  const out: unknown[] = [null];
  if (!api.sidText(sid, out)) throw new Error("Windows could not name a SID.");
  const text = koffi.decode(out[0], "char16_t", -1) as string;
  api.localFree(out[0]);
  return text;
}

function hex(result: number): string {
  return `0x${(result >>> 0).toString(16).padStart(8, "0")}`;
}

const containers = new Map<string, string>();

/**
 * The container with this name, as its SID's text, its profile registered on
 * first use and kept until it is removed.
 */
export function containerFor(name: string): string {
  let container = containers.get(name);
  if (!container) {
    container = registered(name);
    containers.set(name, container);
  }
  return container;
}

/**
 * Removes a container's profile, with the folder Windows keeps for it in the
 * person's profile. Whether it was there or not, it is not afterwards; one
 * Windows will not remove is left, and says nothing.
 */
export function removeContainer(name: string): void {
  containers.delete(name);
  userenv().deleteProfile(name);
}

function registered(name: string): string {
  const api = userenv();
  const out: unknown[] = [null];
  const created = api.createProfile(name, out);
  if (created !== 0 && created !== alreadyExists)
    throw new Error(
      `Windows could not register the app container ${name} (${hex(created)}).`,
    );
  if (created === alreadyExists) {
    const derived = api.deriveContainer(name, out);
    if (derived !== 0)
      throw new Error(
        `Windows could not name the app container ${name} (${hex(derived)}).`,
      );
  }
  const container = textOf(api, out[0]);
  api.freeSid(out[0]);
  return container;
}

/** The SID of the capability with this name, as text. */
export function capabilityNamed(name: string): string {
  const api = userenv();
  const groups: unknown[] = [null];
  const groupCount = [0];
  const sids: unknown[] = [null];
  const sidCount = [0];
  if (!api.deriveCapabilities(name, groups, groupCount, sids, sidCount))
    throw new Error(`Windows could not name the capability ${name}.`);
  const each = (list: unknown, count: number) =>
    count ? (koffi.decode(list, koffi.array("void*", count)) as unknown[]) : [];
  const capabilities = each(sids[0], sidCount[0] ?? 0);
  const text = capabilities[0] ? textOf(api, capabilities[0]) : undefined;
  for (const sid of [...capabilities, ...each(groups[0], groupCount[0] ?? 0)])
    api.localFree(sid);
  api.localFree(sids[0]);
  api.localFree(groups[0]);
  if (!text) throw new Error(`Windows gave no SID for the capability ${name}.`);
  return text;
}

/**
 * The attribute that starts a process in `container` holding
 * `capabilities`. Its memory must outlive the process's creation, and is
 * then released.
 */
export function securityCapabilities(
  container: string,
  capabilities: readonly string[],
): {
  readonly attribute: number;
  readonly value: unknown;
  readonly size: number;
  release(): void;
} {
  const api = userenv();
  const sids: unknown[] = [];
  const sid = (text: string) => {
    const out: unknown[] = [null];
    if (!api.sidFromText(text, out))
      throw new Error(`Windows does not know the SID ${text}.`);
    sids.push(out[0]);
    return out[0];
  };
  const blocks: unknown[] = [];
  const release = () => {
    for (const block of blocks.splice(0)) koffi.free(block);
    for (const each of sids.splice(0)) api.localFree(each);
  };
  try {
    const containerSid = sid(container);
    let list: unknown = null;
    if (capabilities.length) {
      list = koffi.alloc(api.sidAndAttributesType, capabilities.length);
      blocks.push(list);
      koffi.encode(
        list,
        koffi.array(api.sidAndAttributesType, capabilities.length),
        capabilities.map((text) => ({
          Sid: sid(text),
          Attributes: SE_GROUP_ENABLED,
        })),
      );
    }
    const value = koffi.alloc(api.capabilitiesType, 1);
    blocks.push(value);
    koffi.encode(value, api.capabilitiesType, {
      AppContainerSid: containerSid,
      Capabilities: list,
      CapabilityCount: capabilities.length,
      Reserved: 0,
    });
    return {
      attribute: PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
      value,
      size: koffi.sizeof(api.capabilitiesType),
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
