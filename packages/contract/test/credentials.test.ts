/**
 * Anything that leaves the computer, or reaches the model as evidence, has the
 * credentials Zhiyin can recognise removed first. Recognised, not proven: a
 * format nobody listed passes through, so what removes them never claims more.
 */

import { describe, expect, it } from "vitest";
import {
  credentialOmitted,
  textWithoutCredentials,
  withoutCredentials,
} from "../src/index.js";

describe("credentials in a record", () => {
  it("blanks a field named like a credential, at any depth", () => {
    expect(
      withoutCredentials({
        query: "odyssey",
        headers: { Authorization: "Basic dXNlcjpwYXNz", "X-Api-Key": "k1" },
        nested: [{ apiKey: "k2", client_secret: "k3", refresh_token: "k4" }],
      }),
    ).toEqual({
      query: "odyssey",
      headers: {
        Authorization: credentialOmitted,
        "X-Api-Key": credentialOmitted,
      },
      nested: [
        {
          apiKey: credentialOmitted,
          client_secret: credentialOmitted,
          refresh_token: credentialOmitted,
        },
      ],
    });
  });

  it("removes a credential written inside a string field", () => {
    expect(
      withoutCredentials({
        command: 'curl -H "Authorization: Bearer abc.def" https://example.com',
        arguments: '{"api_key":"x","q":"weather"}',
      }),
    ).toEqual({
      command: `curl -H "Authorization: ${credentialOmitted}" https://example.com`,
      arguments: `{"api_key":"${credentialOmitted}","q":"weather"}`,
    });
  });

  it("leaves numbers, flags and ordinary words as they were, and changes nothing it was given", () => {
    const record = {
      inputTokens: 1200,
      outputTokens: 80,
      ok: true,
      text: "Three files changed.",
    };

    expect(withoutCredentials(record)).toEqual(record);
    expect(record.text).toBe("Three files changed.");
  });
});

describe("credentials in text", () => {
  it.each([
    ["Bearer abc.def-123", `Bearer ${credentialOmitted}`],
    ["Authorization: token ghp_x", `Authorization: ${credentialOmitted}`],
    [
      "mysql --password=hunter2 -u root",
      `mysql --password=${credentialOmitted} -u root`,
    ],
    [
      "git clone https://ana:s3cret@example.com/repo.git",
      `git clone https://ana:${credentialOmitted}@example.com/repo.git`,
    ],
    ["key sk-or-v1-0123456789abcdef0123", `key ${credentialOmitted}`],
    ["token ghp_0123456789abcdefABCDEF0123", `token ${credentialOmitted}`],
    ["slack xoxb-1234567890-abcdefghij", `slack ${credentialOmitted}`],
    ['"password": "hunter2"', `"password": "${credentialOmitted}"`],
  ])("removes %s", (text, expected) => {
    expect(textWithoutCredentials(text)).toBe(expected);
  });

  it("never shortens what it was given", () => {
    const long = "word ".repeat(20_000);

    expect(textWithoutCredentials(long)).toBe(long);
  });

  it.each([
    "Paste your API key in Settings.",
    "The password field is empty.",
    "A bearer bond is not a token.",
    "sk-short",
  ])("leaves %s alone", (text) => {
    expect(textWithoutCredentials(text)).toBe(text);
  });
});
