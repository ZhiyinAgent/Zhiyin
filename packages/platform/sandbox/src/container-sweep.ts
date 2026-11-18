/**
 * Removes the containers Zhiyin registered whose home is gone. Windows keeps
 * every container of the person's in the registry, by its SID, with its name
 * and display name; Zhiyin's name begins `Zhiyin.` and its display name
 * records its home.
 */

import { existsSync } from "node:fs";
import koffi from "koffi";
import { homeNamed, removeContainer } from "./app-container.js";

/** `HKEY_CURRENT_USER`, as the signed handle Windows defines it as. */
const HKEY_CURRENT_USER = -0x7fffffff;
const KEY_READ = 0x20019;
const RRF_RT_REG_SZ = 0x2;
const ERROR_NO_MORE_ITEMS = 259;
const mappings =
  "Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppContainer\\Mappings";

type Registry = {
  readonly open: (key: number, path: string, out: number[]) => number;
  readonly subkey: (
    key: number,
    index: number,
    name: Buffer,
    length: number[],
  ) => number;
  readonly value: (
    key: number,
    subkey: string,
    name: string,
    data: Buffer,
    size: number[],
  ) => number;
  readonly close: (key: number) => number;
};

let loaded: Registry | undefined;

function registry(): Registry {
  if (loaded) return loaded;
  const advapi32 = koffi.load("advapi32.dll");
  const RegOpenKeyExW = advapi32.func(
    "int32 RegOpenKeyExW(intptr, const char16_t*, uint32, uint32, _Out_ intptr*)",
  );
  const RegEnumKeyExW = advapi32.func(
    "int32 RegEnumKeyExW(intptr, uint32, _Out_ uint8_t*, _Inout_ uint32*, void*, void*, void*, void*)",
  );
  const RegGetValueW = advapi32.func(
    "int32 RegGetValueW(intptr, const char16_t*, const char16_t*, uint32, void*, _Out_ uint8_t*, _Inout_ uint32*)",
  );
  const RegCloseKey = advapi32.func("int32 RegCloseKey(intptr)");
  loaded = {
    open: (key, path, out) => RegOpenKeyExW(key, path, 0, KEY_READ, out),
    subkey: (key, index, name, length) =>
      RegEnumKeyExW(key, index, name, length, null, null, null, null),
    value: (key, subkey, name, data, size) =>
      RegGetValueW(key, subkey, name, RRF_RT_REG_SZ, null, data, size),
    close: (key) => RegCloseKey(key),
  };
  return loaded;
}

/** A text value of a container's key, or nothing where it has none. */
function text(api: Registry, key: number, sid: string, name: string) {
  const data = Buffer.alloc(4096);
  const size = [data.length];
  if (api.value(key, sid, name, data, size) !== 0) return undefined;
  return data.subarray(0, size[0]).toString("utf16le").replace(/\0+$/, "");
}

/** Every container of the person's, by name, with its display name. */
function registeredContainers(): { name: string; display: string }[] {
  const api = registry();
  const opened = [0];
  if (api.open(HKEY_CURRENT_USER, mappings, opened) !== 0) return [];
  const key = opened[0]!;
  const found: { name: string; display: string }[] = [];
  try {
    for (let index = 0; ; index += 1) {
      const name = Buffer.alloc(512);
      const length = [name.length / 2];
      const result = api.subkey(key, index, name, length);
      if (result === ERROR_NO_MORE_ITEMS) break;
      if (result !== 0) continue;
      const sid = name.subarray(0, length[0]! * 2).toString("utf16le");
      const moniker = text(api, key, sid, "Moniker");
      if (moniker)
        found.push({
          name: moniker,
          display: text(api, key, sid, "DisplayName") ?? "",
        });
    }
  } finally {
    api.close(key);
  }
  return found;
}

/**
 * Removes Zhiyin's containers whose home is gone, of the purposes named, or
 * of every purpose, and answers how many went. A home is made before its
 * container is registered, so a container in use always has its home. A step
 * apart from each removal, so the app's other work goes on meanwhile.
 */
export async function removeUnusedContainers(
  purposes?: readonly string[],
): Promise<number> {
  const ofPurpose = (name: string) =>
    !purposes ||
    purposes.some((purpose) => name.startsWith(`zhiyin.${purpose}.`));
  const unused = registeredContainers().filter(({ name, display }) => {
    const lower = name.toLowerCase();
    if (!lower.startsWith("zhiyin.") || !ofPurpose(lower)) return false;
    const home = homeNamed(display);
    return home !== undefined && !existsSync(home);
  });
  for (const { name } of unused) {
    removeContainer(name);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return unused.length;
}
