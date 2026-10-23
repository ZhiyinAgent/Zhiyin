// Answers each chunk it reads on one handle with the same text in capitals on
// the other. The handle values arrive as arguments, the only way a process
// can learn them.
import koffi from "koffi";

const kernel32 = koffi.load("kernel32.dll");
const ReadFile = kernel32.func(
  "bool ReadFile(intptr_t, void*, uint32, _Out_ uint32*, void*)",
);
const WriteFile = kernel32.func(
  "bool WriteFile(intptr_t, void*, uint32, _Out_ uint32*, void*)",
);

const [reads, writes] = process.argv.slice(2).map(Number);
const buffer = Buffer.alloc(4096);
for (;;) {
  const count = [0];
  if (!ReadFile(reads, buffer, buffer.length, count, null) || !count[0]) break;
  const answer = Buffer.from(
    buffer.subarray(0, count[0]).toString("utf8").toUpperCase(),
  );
  WriteFile(writes, answer, answer.length, [0], null);
}
