/** How sizes and lengths of time are written, the same wherever they show. */

const kilobyte = 1024;
const megabyte = 1024 * 1024;

/**
 * "1 byte", "240 bytes", "1.5 KB", "47 KB", "10.0 MB". Below ten kilobytes a
 * tenth is kept, since whole ones would overstate a small file by up to a
 * third.
 */
export function fileSize(bytes: number): string {
  if (bytes < kilobyte) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < megabyte) {
    const kilobytes = bytes / kilobyte;
    return kilobytes < 10
      ? `${Number(kilobytes.toFixed(1))} KB`
      : `${Math.round(kilobytes)} KB`;
  }
  return `${(bytes / megabyte).toFixed(1)} MB`;
}

/** "5 s", "1 min", "1 min 20 s", "2 h", "1 h 5 min": a remainder of zero is left out. */
export function elapsedTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return withRemainder(`${minutes} min`, seconds % 60, "s");
  return withRemainder(`${Math.floor(minutes / 60)} h`, minutes % 60, "min");
}

function withRemainder(whole: string, remainder: number, unit: string): string {
  return remainder === 0 ? whole : `${whole} ${remainder} ${unit}`;
}
