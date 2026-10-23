import { describe, expect, it } from "vitest";
import { windowsEnvironment } from "../src/index.js";

describe("the environment a confined program is given", () => {
  it("keeps what Windows programs expect and how the network is reached, whatever the case", () => {
    expect(
      windowsEnvironment({
        SystemRoot: "C:\\Windows",
        Path: "C:\\Windows\\System32",
        HTTPS_PROXY: "http://proxy.example:8080",
        ssl_cert_file: "C:\\certs\\roots.pem",
      }),
    ).toEqual({
      SystemRoot: "C:\\Windows",
      Path: "C:\\Windows\\System32",
      HTTPS_PROXY: "http://proxy.example:8080",
      ssl_cert_file: "C:\\certs\\roots.pem",
    });
  });

  it("passes no credential and nothing that names what a program loads", () => {
    expect(
      windowsEnvironment({
        GITHUB_TOKEN: "ghp_not_a_real_token",
        OPENAI_API_KEY: "sk-not-a-real-key",
        AWS_SECRET_ACCESS_KEY: "not-a-real-secret",
        BLENDER_SYSTEM_SCRIPTS: "C:\\planted",
        PYTHONSTARTUP: "C:\\planted\\start.py",
        PIP_INDEX_URL: "https://packages.example/simple",
        SystemRoot: "C:\\Windows",
      }),
    ).toEqual({ SystemRoot: "C:\\Windows" });
  });
});
