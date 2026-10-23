import { win32 } from "node:path";

/**
 * Whether two spellings name the same folder. Windows ignores letter case and
 * which separator is used, and a trailing separator names the same folder.
 */
export function sameFolder(a: string, b: string): boolean {
  return folderKey(a) === folderKey(b);
}

function folderKey(path: string): string {
  const normal = win32.normalize(path);
  const root = win32.parse(normal).root;
  const trimmed =
    normal.length > root.length ? normal.replace(/\\+$/, "") : normal;
  return trimmed.toLowerCase();
}
