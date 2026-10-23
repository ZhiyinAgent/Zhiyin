/**
 * Where the app's own mark lives, relative to the running main process.
 *
 * Named here rather than inline so the same list is what the window loads and
 * what a test checks. The failure this exists to catch is a path that resolves
 * in the source tree and not in the built one.
 */
export function iconCandidates(mainDirectory: string): string[] {
  const root = mainDirectory.split("\\").join("/").replace(/\/+$/, "");
  return [`${root}/../../build/icon.ico`, `${root}/build/icon.ico`];
}
