// Lets a fixture run this package's source under type stripping, where a
// module's `.js` import of a sibling names a file that exists only as `.ts`.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".") || !specifier.endsWith(".js")) throw error;
    return next(`${specifier.slice(0, -3)}.ts`, context);
  }
}
