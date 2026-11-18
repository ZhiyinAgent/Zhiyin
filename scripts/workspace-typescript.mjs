/**
 * Lets a script run with plain Node import the workspace's packages. They are
 * TypeScript importing each other with `.js`; Node strips the types, and the
 * hook registered here finds the `.ts` file a `.js` import names.
 */

import { register } from "node:module";

let registered = false;

export function resolveWorkspaceTypeScript() {
  if (registered) return;
  registered = true;
  register(
    "data:text/javascript," +
      encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && specifier.endsWith(".js"))
      return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
}`),
  );
}
