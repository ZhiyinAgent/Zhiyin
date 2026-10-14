/** How sizes and lengths of time are written, the same wherever they show. */

const kilobyte = 1024;
const megabyte = 1024 * 1024;

/** "1 byte", "240 bytes", "47 KB", "10.0 MB". */
export function fileSize(bytes: number): string {
  if (bytes < kilobyte) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < megabyte) return `${Math.round(bytes / kilobyte)} KB`;
  return `${(bytes / megabyte).toFixed(1)} MB`;
}

/** "5 s", "1 min 20 s", "1 h 5 min". */
export function elapsedTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
