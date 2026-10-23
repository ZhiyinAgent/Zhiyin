/** A text's size in UTF-8, counted without building an encoded copy of it. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code < 0xdc00 &&
      index + 1 < text.length &&
      (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00
    ) {
      // A surrogate pair is one character of four bytes.
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * How many tokens a text is counted as before a provider has counted it: its
 * UTF-8 bytes ÷ 3. Close for Chinese, whose characters take three bytes and
 * about one token each, and cautious for English and JSON, at about four bytes
 * a token — so a limit stated in tokens means the same in every language.
 */
export function estimatedTokens(text: string): number {
  return Math.ceil(utf8Bytes(text) / 3);
}
