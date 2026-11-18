import { describe, expect, it } from "vitest";
import { testSwitches } from "../src/index.js";

/**
 * A few behaviours exist only so the built app can be tested: a dictionary
 * and a model list fetched from a test server, a fixed model and the address
 * its requests go to, connections that never close,
 * a credential store that refuses, requests sent over Node's own network,
 * where tools that trace or replay a run can see them, the folder a run
 * starts in, and Blender behaving as on a PC whose graphics card cannot draw.
 * The installed app honours none of them, whatever its environment says.
 */

const asked = {
  ZHIYIN_TEST_WORKSPACE: "C:\\Evaluation\\case-1",
  ZHIYIN_TEST_DICTIONARY_SERVER: "http://127.0.0.1:9/",
  ZHIYIN_TEST_MODEL_LIST_SERVER: "http://127.0.0.1:9/lists/",
  ZHIYIN_TEST_CONNECTIONS_NEVER_CLOSE: "1",
  ZHIYIN_TEST_CREDENTIALS_UNAVAILABLE: "1",
  ZHIYIN_TEST_NODE_NETWORK: "1",
  ZHIYIN_TEST_MODEL: "deepseek/deepseek-v4.1-flash",
  ZHIYIN_TEST_PROVIDER: "deepseek",
  ZHIYIN_TEST_REGION: "eu",
  ZHIYIN_TEST_MODEL_ENDPOINT: "https://elsewhere.test/api/v1/chat/completions",
  ZHIYIN_TEST_NO_GRAPHICS_CARD: "1",
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
      model: {
        model: "deepseek/deepseek-v4.1-flash",
        provider: "deepseek",
        region: "eu",
      },
      modelEndpoint: "https://elsewhere.test/api/v1/chat/completions",
      noGraphicsCard: true,
    });
  });

  it("fix a model on no named provider or region when only the model is named", () => {
    expect(
      testSwitches({ ZHIYIN_TEST_MODEL: "z-ai/glm-5.3-flash" }, false).model,
    ).toEqual({ model: "z-ai/glm-5.3-flash" });
  });

  it("start a build in no folder when the folder is set empty", () => {
    expect(testSwitches({ ZHIYIN_TEST_WORKSPACE: "" }, false).workspace).toBe(
      "",
    );
  });

  it("are read only under their one prefix", () => {
    expect(
      testSwitches(
        {
          ZHIYIN_WORKSPACE: "C:\\Evaluation\\case-1",
          ZHIYIN_MODEL: "deepseek/deepseek-v4.1-flash",
        },
        false,
      ),
    ).toEqual({
      connectionsNeverClose: false,
      credentialsUnavailable: false,
      nodeNetwork: false,
    });
  });

  it("are ignored by the installed app", () => {
    expect(testSwitches(asked, true)).toEqual({
      connectionsNeverClose: false,
      credentialsUnavailable: false,
      nodeNetwork: false,
    });
  });
});
