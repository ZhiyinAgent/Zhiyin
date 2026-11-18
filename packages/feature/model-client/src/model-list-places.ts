/**
 * Where the model list is published (ADR 0027). Kept apart, with
 * nothing else in it, so the scripts that publish and check Zhiyin's copy
 * read the same addresses the app does.
 */

/** One place the list and its signature are published, named as a person reads it. */
export type ModelListPlace = {
  readonly name: string;
  readonly list: string;
  readonly signature: string;
};

/**
 * Where the list Zhiyin reads is published, tried in this order: the
 * repository's main branch, then Zhiyin's copy of the same two files on its
 * own host, uploaded with each signed list. The signature is what is
 * trusted, wherever it came from.
 */
export const modelListPlaces: readonly ModelListPlace[] = [
  {
    name: "GitHub",
    list: "https://raw.githubusercontent.com/ZhiyinAgent/Zhiyin/main/packages/feature/model-client/model-list/models.json",
    signature:
      "https://raw.githubusercontent.com/ZhiyinAgent/Zhiyin/main/packages/feature/model-client/model-list/models.json.sig",
  },
  {
    name: "media.zhiyinagent.app",
    list: "https://media.zhiyinagent.app/model-list/models.json",
    signature: "https://media.zhiyinagent.app/model-list/models.json.sig",
  },
];
