/**
 * Behaviours that exist only so the built app can be tested, read from its
 * environment. The installed app honours none of them: what a test needs to
 * set must never be something anyone can set on a person's computer.
 */

export type TestSwitches = {
  /**
   * The folder a run starts in, from ZHIYIN_WORKSPACE, as an evaluation or a
   * recording sets it; empty starts it in none.
   */
  readonly workspace?: string;
  /** Where a dictionary that is not bundled is fetched from. */
  readonly dictionaryServer?: string;
  /** Where a newer model list and its signature are read from (ADR 0031). */
  readonly modelListServer?: string;
  readonly connectionsNeverClose: boolean;
  /** The credential store refuses every read and write. */
  readonly credentialsUnavailable: boolean;
  /**
   * Requests go over Node's own network instead of Chromium's, where a tool
   * that traces or replays a run can see them (ADR 0004).
   */
  readonly nodeNetwork: boolean;
};

export function testSwitches(
  environment: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): TestSwitches {
  const read = (name: string) =>
    packaged ? undefined : environment[`ZHIYIN_TEST_${name}`];
  const dictionaryServer = read("DICTIONARY_SERVER");
  const modelListServer = read("MODEL_LIST_SERVER");
  const workspace = packaged ? undefined : environment["ZHIYIN_WORKSPACE"];
  return {
    ...(workspace !== undefined ? { workspace } : {}),
    ...(dictionaryServer ? { dictionaryServer } : {}),
    ...(modelListServer ? { modelListServer } : {}),
    connectionsNeverClose: read("CONNECTIONS_NEVER_CLOSE") === "1",
    credentialsUnavailable: read("CREDENTIALS_UNAVAILABLE") === "1",
    nodeNetwork: read("NODE_NETWORK") === "1",
  };
}
