import { describe, expect, it } from "vitest";
import { testSwitches } from "../src/index.js";

/**
 * A few behaviours exist only so the built app can be tested: a dictionary
 * fetched from a test server, connections that never close, a credential
 * store that refuses. The installed app honours none of them, whatever its
 * environment says.
 */

const asked = {
  ZHIYIN_TEST_DICTIONARY_SERVER: "http://127.0.0.1:9/",
  ZHIYIN_TEST_CONNECTIONS_NEVER_CLOSE: "1",
  ZHIYIN_TEST_CREDENTIALS_UNAVAILABLE: "1",
};

describe("switches meant for tests", () => {
  it("are read from the environment of a build that is not installed", () => {
    expect(testSwitches(asked, false)).toEqual({
      dictionaryServer: "http://127.0.0.1:9/",
      connectionsNeverClose: true,
      credentialsUnavailable: true,
    });
  });

  it("are ignored by the installed app", () => {
    expect(testSwitches(asked, true)).toEqual({
      connectionsNeverClose: false,
      credentialsUnavailable: false,
    });
  });
});
