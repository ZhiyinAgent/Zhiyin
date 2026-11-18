/**
 * The one rule for the portable names a package carries (plugins, skills,
 * specialists and connectors): lowercase letters and digits in words joined
 * by single hyphens. The plugins, the core's check of what reaches it and the
 * window all apply this one, so a name one of them accepts the others do too.
 */

export const portableName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The longest portable name. */
export const portableNameLength = 128;
