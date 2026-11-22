/**
 * The alternate data streams a file holds beside its contents, such as the
 * mark Windows puts on a downloaded file, by name.
 */

import koffi from "koffi";

type Finder = (path: string) => string[];

let finder: Finder | undefined;

function load(): Finder {
  const kernel32 = koffi.load("kernel32.dll");
  // WIN32_FIND_STREAM_DATA: a 64-bit size, then MAX_PATH + 36 wide characters.
  const data = koffi.struct({
    StreamSize: "int64",
    cStreamName: koffi.array("char16_t", 296, "Array"),
  });
  const FindFirstStreamW = kernel32.func(
    "void* FindFirstStreamW(const char16_t*, int, _Out_ void*, uint32)",
  );
  const FindNextStreamW = kernel32.func(
    "bool FindNextStreamW(void*, _Out_ void*)",
  );
  const FindClose = kernel32.func("bool FindClose(void*)");
  const size = koffi.sizeof(data);
  const nameOf = (buffer: Buffer) => {
    const text = buffer.toString("utf16le", 8, size);
    return text.slice(0, text.indexOf("\0"));
  };
  return (path) => {
    const buffer = Buffer.alloc(size);
    const handle = FindFirstStreamW(path, 0, buffer, 0);
    if (!handle || koffi.address(handle) === BigInt.asUintN(64, -1n)) return [];
    const names: string[] = [];
    try {
      do {
        // ":name:$DATA"; the file's own contents are "::$DATA".
        const [, name, type] = nameOf(buffer).split(":");
        if (name && type === "$DATA") names.push(name);
      } while (FindNextStreamW(handle, buffer));
    } finally {
      FindClose(handle);
    }
    return names;
  };
}

/** The names of the file's alternate data streams; none where Windows keeps none. */
export function alternateStreams(path: string): string[] {
  if (process.platform !== "win32") return [];
  finder ??= load();
  return finder(path);
}
