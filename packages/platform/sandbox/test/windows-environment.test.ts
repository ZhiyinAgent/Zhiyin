import { describe, expect, it } from "vitest";
import { windowsEnvironment } from "../src/index.js";

describe("the environment a confined program is given", () => {
  it("keeps what Windows programs expect and the certificates this computer trusts, whatever the case", () => {
    expect(
      windowsEnvironment({
        SystemRoot: "C:\\Windows",
        Path: "C:\\Windows\\System32",
        ssl_cert_file: "C:\\certs\\roots.pem",
      }),
    ).toEqual({
      SystemRoot: "C:\\Windows",
      Path: "C:\\Windows\\System32",
      ssl_cert_file: "C:\\certs\\roots.pem",
    });
  });

  it("names no proxy, which a confined program could not reach", () => {
    expect(
      windowsEnvironment({
        HTTPS_PROXY: "http://person:secret@proxy.example:8080",
        http_proxy: "http://proxy.example:8080",
        ALL_PROXY: "socks5://proxy.example:1080",
        NO_PROXY: "localhost",
        SystemRoot: "C:\\Windows",
      }),
    ).toEqual({ SystemRoot: "C:\\Windows" });
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
