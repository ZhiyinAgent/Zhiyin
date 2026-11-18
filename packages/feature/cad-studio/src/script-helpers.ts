/** The module a CAD script imports show and the helpers from, which a build also gives without the import. */
export const helpersModule = "zhiyin_cad_helpers";

/** The one file a build writes for that module, beside a script, so the script runs outside Zhiyin. */
export const helpersFile = `${helpersModule}.py`;

/** What that file holds, as the approval and the answer say it. */
export const helpersFileWords =
  "show and the helpers as one module, so a script beside it runs with build123d outside Zhiyin";

/** The shaping helpers a CAD script is given, as the harness gives them. */
export const scriptHelpers = [
  "round_edges",
  "cast",
  "boss",
  "pad",
  "rib",
  "cutaway",
  "bolt_circle",
  "bolt_row",
  "pipe",
  "coil",
  "hose",
  "belt",
] as const;

/** The engineering helpers given beside them: sheet metal, strength checks and ISO 286 fits. */
export const engineeringHelpers = ["sheet", "strength", "iso_fit"] as const;

/** Every helper a script is given, as the tools name them. */
export const allHelpers = [...scriptHelpers, ...engineeringHelpers] as const;
