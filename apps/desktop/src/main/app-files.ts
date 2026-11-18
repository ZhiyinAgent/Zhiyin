/**
 * The window's own files, served from an address of their own.
 *
 * A page loaded from `file:` counts every file on the computer, and every
 * network share, as its own, so its security policy's `'self'` would let it
 * reach them. Loaded from here, `'self'` names the built window and nothing
 * else. This is a plain function so the rule can be shown to hold without
 * Electron; the main process hands it each request.
 */

import { isAbsolute, join, relative } from "node:path";

export const appScheme = "zhiyin";
const appHost = "app";

/** The window's page, with what it was opened for. */
export function appPage(query?: Readonly<Record<string, string>>): string {
  const page = new URL(`${appScheme}://${appHost}/index.html`);
  if (query) page.search = new URLSearchParams(query).toString();
  return page.toString();
}

/**
 * The file of the built window an address names, or nothing for any other.
 * A path naming a drive, a share or a folder above the window is refused
 * rather than resolved.
 */
export function appFileOf(root: string, address: string): string | undefined {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  if (url.protocol !== `${appScheme}:` || url.host !== appHost)
    return undefined;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  if (/[\\:\0]/.test(path) || path.split("/").includes("..")) return undefined;
  const file = join(root, path);
  const inside = relative(root, file);
  if (!inside || inside.startsWith("..") || isAbsolute(inside))
    return undefined;
  return file;
}
