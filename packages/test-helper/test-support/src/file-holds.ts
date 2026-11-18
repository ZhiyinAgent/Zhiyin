import koffi from "koffi";

const kernel32 = koffi.load("kernel32.dll");
const CreateFileW = kernel32.func(
  "void* __stdcall CreateFileW(const char16_t*, uint32, uint32, void*, uint32, uint32, void*)",
);
const CloseHandle = kernel32.func("bool __stdcall CloseHandle(void*)");

const genericRead = 0x80000000;
const shareRead = 0x1;
const openExisting = 3;
const invalidHandle = BigInt.asUintN(64, -1n);

/**
 * Opens a file for reading the way another program can: sharing reading
 * only, as Office, many editors and scanners do, or nothing at all. While it
 * is held, no program may replace, rename or remove it, and with nothing
 * shared none may read it either. The returned function lets it go, and is
 * harmless more than once.
 */
export function holdOpen(
  path: string,
  shares: "reading" | "nothing" = "reading",
): () => void {
  const handle = CreateFileW(
    path,
    genericRead,
    shares === "reading" ? shareRead : 0,
    null,
    openExisting,
    0,
    null,
  );
  if (koffi.address(handle) === invalidHandle)
    throw new Error(`${path} could not be held.`);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    CloseHandle(handle);
  };
}
