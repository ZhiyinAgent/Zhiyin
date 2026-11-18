/**
 * Whether a text file's bytes are all UTF-8, answered as they stream past.
 */

/**
 * The first line, counted from 1, holding bytes that are not UTF-8, or
 * nothing when every byte is.
 */
export async function firstLineNotUtf8(
  bytes: AsyncIterable<Uint8Array>,
): Promise<number | undefined> {
  let line = 1;
  // A line ends at a line feed, a carriage return, or the two together.
  let afterReturn = false;
  // Continuation bytes still owed by the character under way, and the range
  // the next one must fall in, which the first byte narrows.
  let owed = 0;
  let lowest = 0x80;
  let highest = 0xbf;
  for await (const chunk of bytes)
    for (const byte of chunk) {
      if (owed) {
        if (byte < lowest || byte > highest) return line;
        lowest = 0x80;
        highest = 0xbf;
        owed -= 1;
        continue;
      }
      if (byte === 0x0d || (byte === 0x0a && !afterReturn)) line += 1;
      afterReturn = byte === 0x0d;
      if (byte < 0x80) continue;
      if (byte >= 0xc2 && byte <= 0xdf) owed = 1;
      else if (byte === 0xe0) [owed, lowest] = [2, 0xa0];
      else if (byte === 0xed) [owed, highest] = [2, 0x9f];
      else if (byte >= 0xe1 && byte <= 0xef) owed = 2;
      else if (byte === 0xf0) [owed, lowest] = [3, 0x90];
      else if (byte === 0xf4) [owed, highest] = [3, 0x8f];
      else if (byte >= 0xf1 && byte <= 0xf3) owed = 3;
      else return line;
    }
  return owed ? line : undefined;
}
