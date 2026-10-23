import { describe, expect, it } from "vitest";
import { testSwitches } from "../src/index.js";

/**
 * A few behaviours exist only so the built app can be tested: a dictionary
 * and a model list fetched from a test server, connections that never close,
 * a credential store that refuses, requests sent over Node's own network,
 * where tools that trace or replay a run can see them, and the folder a run
 * starts in.
 * The installed app honours none of them, whatever its environment says.
 */

const asked = {
  ZHIYIN_WORKSPACE: "C:\\Evaluation\\case-1",
  ZHIYIN_TEST_DICTIONARY_SERVER: "http://127.0.0.1:9/",
  ZHIYIN_TEST_MODEL_LIST_SERVER: "http://127.0.0.1:9/lists/",
  ZHIYIN_TEST_CONNECTIONS_NEVER_CLOSE: "1",
  ZHIYIN_TEST_CREDENTIALS_UNAVAILABLE: "1",
  ZHIYIN_TEST_NODE_NETWORK: "1",
};

describe("switches meant for tests", () => {
  it("are read from the environment of a build that is not installed", () => {
    expect(testSwitches(asked, false)).toEqual({
      workspace: "C:\\Evaluation\\case-1",
      dictionaryServer: "http://127.0.0.1:9/",
      modelListServer: "http://127.0.0.1:9/lists/",
      connectionsNeverClose: true,
      credentialsUnavailable: true,
      nodeNetwork: true,
    });
  });

  it("start a build in no folder when the folder is set empty", () => {
    expect(testSwitches({ ZHIYIN_WORKSPACE: "" }, false).workspace).toBe("");
  });

  it("are ignored by the installed app", () => {
    expect(testSwitches(asked, true)).toEqual({
      connectionsNeverClose: false,
      credentialsUnavailable: false,
      nodeNetwork: false,
    });
  });
});
