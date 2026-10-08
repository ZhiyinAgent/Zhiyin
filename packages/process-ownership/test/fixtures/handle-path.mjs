// Prints the path of the file a handle value refers to in this process, or
// nothing when the value refers to no file here.
import koffi from "koffi";

const kernel32 = koffi.load("kernel32.dll");
const GetFinalPathNameByHandleW = kernel32.func(
  "uint32 GetFinalPathNameByHandleW(intptr_t, void*, uint32, uint32)",
);

const wide = Buffer.alloc(2048);
const length = GetFinalPathNameByHandleW(
  Number(process.argv[2]),
  wide,
  wide.length / 2,
  0,
);
if (length > 0 && length < wide.length / 2)
  process.stdout.write(wide.toString("utf16le", 0, length * 2));
