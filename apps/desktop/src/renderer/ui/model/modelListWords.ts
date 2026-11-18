import type { ModelListState } from "@zhiyin/contract";

const publishedOn = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Where the labs' models and prices come from (ADR 0027), in a sentence:
 * Zhiyin's list in force, shipped with this version or downloaded since, and
 * while updates are on, that a newer one is being looked for or why none
 * could be used.
 */
export function modelListWords(
  state: ModelListState,
  checking: boolean,
): string {
  const published = publishedOn.format(
    new Date(`${state.published}T00:00:00Z`),
  );
  const failed =
    !checking && state.updates && state.lastCheck?.outcome === "failed"
      ? state.lastCheck.reason
      : undefined;
  return [
    `Models and prices come from Zhiyin's list of ${published}, ${
      state.source === "shipped"
        ? "shipped with this version."
        : "updated since this version shipped."
    }`,
    checking && "Checking for a newer list…",
    failed && `No newer list could be used: ${failed}`,
  ]
    .filter(Boolean)
    .join(" ");
}
