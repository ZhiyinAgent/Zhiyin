/**
 * Who may open the proxy's pipe. Node makes a pipe with Windows' default
 * permissions, which let no app container in; once it listens, its
 * permissions are replaced by name with ones that let in the person, Windows
 * itself and the one container the run is in. Every instance the server makes
 * later shares them.
 */

import koffi from "koffi";
import { windowsFiles } from "../windows-files.js";

type Advapi = {
  readonly descriptor: (sddl: string, out: unknown[]) => boolean;
  readonly dacl: (
    descriptor: unknown,
    present: number[],
    dacl: unknown[],
    defaulted: number[],
  ) => boolean;
  readonly setNamed: (path: string, dacl: unknown) => number;
  readonly free: (memory: unknown) => unknown;
};

let api: Advapi | undefined;

function advapi(): Advapi {
  if (api) return api;
  const advapi32 = koffi.load("advapi32.dll");
  const files = windowsFiles();
  const toDescriptor = advapi32.func(
    "bool ConvertStringSecurityDescriptorToSecurityDescriptorW(const char16_t*, uint32, _Out_ void**, void*)",
  );
  const getDacl = advapi32.func(
    "bool GetSecurityDescriptorDacl(void*, _Out_ int*, _Out_ void**, _Out_ int*)",
  );
  const setNamed = advapi32.func(
    "uint32 SetNamedSecurityInfoW(const char16_t*, int, uint32, void*, void*, void*, void*)",
  );
  // SE_FILE_OBJECT, which a pipe's name is; a protected DACL inherits nothing.
  const fileObject = 1;
  const protectedDacl = 0x80000000 | 0x4;
  api = {
    descriptor: (sddl, out) => toDescriptor(sddl, 1, out, null),
    dacl: (descriptor, present, dacl, defaulted) =>
      getDacl(descriptor, present, dacl, defaulted),
    setNamed: (path, dacl) =>
      setNamed(path, fileObject, protectedDacl, null, null, dacl, null),
    free: (memory) => files.free(memory),
  };
  return api;
}

/**
 * Lets only the person, Windows and `container` (a SID's text) open the pipe
 * at `path`. Throws, saying what Windows answered, when it cannot.
 */
export function openPipeTo(path: string, container: string): void {
  const windows = advapi();
  const descriptor: unknown[] = [null];
  // Owner rights, so the person running Zhiyin keeps making instances.
  const sddl = `D:P(A;;GA;;;OW)(A;;GA;;;SY)(A;;GRGW;;;${container})`;
  if (!windows.descriptor(sddl, descriptor))
    throw new Error("The network proxy's permissions could not be written.");
  try {
    const present = [0];
    const dacl: unknown[] = [null];
    const defaulted = [0];
    if (!windows.dacl(descriptor[0], present, dacl, defaulted) || !present[0])
      throw new Error("The network proxy's permissions could not be read.");
    const answered = windows.setNamed(path, dacl[0]);
    if (answered !== 0)
      throw new Error(
        `The network proxy could not be opened to the program (Windows error ${answered}).`,
      );
  } finally {
    windows.free(descriptor[0]);
  }
}
