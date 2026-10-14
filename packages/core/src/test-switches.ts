/**
 * Behaviours that exist only so the built app can be tested, read from its
 * environment. The installed app honours none of them: what a test needs to
 * set must never be something anyone can set on a person's computer.
 */

export type TestSwitches = {
  /** Where a dictionary that is not bundled is fetched from. */
  readonly dictionaryServer?: string;
  readonly connectionsNeverClose: boolean;
  /** The credential store refuses every read and write. */
  readonly credentialsUnavailable: boolean;
};

export function testSwitches(
  environment: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): TestSwitches {
  const read = (name: string) =>
    packaged ? undefined : environment[`ZHIYIN_TEST_${name}`];
  const dictionaryServer = read("DICTIONARY_SERVER");
  return {
    ...(dictionaryServer ? { dictionaryServer } : {}),
    connectionsNeverClose: read("CONNECTIONS_NEVER_CLOSE") === "1",
    credentialsUnavailable: read("CREDENTIALS_UNAVAILABLE") === "1",
  };
}
