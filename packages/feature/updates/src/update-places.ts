/**
 * Where releases are published (ADR 0027). Kept apart, with nothing
 * else in it, so the scripts that publish Zhiyin's copy read the same
 * addresses the app does.
 */

/** One place releases are published, named as a person reads it. */
export type UpdatePlace = { readonly name: string } & (
  | {
      /** A GitHub repository's releases, found from its release feed. */
      readonly kind: "github";
      readonly owner: string;
      readonly repository: string;
    }
  | {
      /**
       * A folder of files: `latest.yml` names the newest release, beside
       * its installer, block map and signature.
       */
      readonly kind: "folder";
      /** Ends in a slash. */
      readonly url: string;
    }
);

/**
 * Tried in this order: the repository's releases, then Zhiyin's copy of the
 * same files on its own host. The signature is what is trusted, wherever the
 * files came from.
 */
export const updatePlaces: readonly UpdatePlace[] = [
  {
    name: "GitHub",
    kind: "github",
    owner: "ZhiyinAgent",
    repository: "Zhiyin",
  },
  {
    name: "media.zhiyinagent.app",
    kind: "folder",
    url: "https://media.zhiyinagent.app/releases/",
  },
];

/** Where a release's signature is published, beside its installer. */
export function signatureAddress(
  place: UpdatePlace,
  release: { readonly version: string; readonly file: string },
): string {
  const name = `${encodeURIComponent(release.file)}.sig`;
  return place.kind === "github"
    ? `https://github.com/${place.owner}/${place.repository}/releases/download/v${encodeURIComponent(release.version)}/${name}`
    : new URL(name, place.url).href;
}
