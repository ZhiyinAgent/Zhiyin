/**
 * Behaviours that exist only so the built app can be tested, read from its
 * environment, each named with the prefix `ZHIYIN_TEST_`. The installed app honours none of
 * them: what a test needs to
 * set must never be something anyone can set on a person's computer.
 */

export type TestSwitches = {
  /**
   * The folder a run starts in, from ZHIYIN_TEST_WORKSPACE, as an evaluation or a
   * recording sets it; empty starts it in none.
   */
  readonly workspace?: string;
  /** Where a dictionary that is not bundled is fetched from. */
  readonly dictionaryServer?: string;
  /** Where a newer model list and its signature are read from (ADR 0027). */
  readonly modelListServer?: string;
  readonly connectionsNeverClose: boolean;
  /** The credential store refuses every read and write. */
  readonly credentialsUnavailable: boolean;
  /**
   * Requests go over Node's own network instead of Chromium's, where a tool
   * that traces or replays a run can see them (ADR 0004).
   */
  readonly nodeNetwork: boolean;
  /**
   * The model every request uses, for a test run or a benchmark, from
   * ZHIYIN_TEST_MODEL, on the provider and region ZHIYIN_TEST_PROVIDER and
   * ZHIYIN_TEST_REGION name; the person cannot choose another.
   */
  readonly model?: {
    readonly model: string;
    readonly provider?: string;
    readonly region?: string;
  };
  /** Where every model request is sent instead, from ZHIYIN_TEST_MODEL_ENDPOINT. */
  readonly modelEndpoint?: string;
  /**
   * Every Blender behaves as on a PC whose graphics card cannot draw, so the
   * 3D studio's way of drawing there runs on a PC that has one. From
   * ZHIYIN_TEST_NO_GRAPHICS_CARD=1.
   */
  readonly noGraphicsCard?: true;
};

export function testSwitches(
  environment: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): TestSwitches {
  const read = (name: string) =>
    packaged ? undefined : environment[`ZHIYIN_TEST_${name}`];
  const dictionaryServer = read("DICTIONARY_SERVER");
  const modelListServer = read("MODEL_LIST_SERVER");
  const workspace = read("WORKSPACE");
  const model = read("MODEL");
  const provider = read("PROVIDER");
  const region = read("REGION");
  const modelEndpoint = read("MODEL_ENDPOINT");
  return {
    ...(workspace !== undefined ? { workspace } : {}),
    ...(dictionaryServer ? { dictionaryServer } : {}),
    ...(modelListServer ? { modelListServer } : {}),
    connectionsNeverClose: read("CONNECTIONS_NEVER_CLOSE") === "1",
    credentialsUnavailable: read("CREDENTIALS_UNAVAILABLE") === "1",
    nodeNetwork: read("NODE_NETWORK") === "1",
    ...(model
      ? {
          model: {
            model,
            ...(provider ? { provider } : {}),
            ...(region ? { region } : {}),
          },
        }
      : {}),
    ...(modelEndpoint ? { modelEndpoint } : {}),
    ...(read("NO_GRAPHICS_CARD") === "1"
      ? { noGraphicsCard: true as const }
      : {}),
  };
}
