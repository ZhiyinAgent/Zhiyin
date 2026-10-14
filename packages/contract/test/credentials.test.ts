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

  it("blanks a text field whose name ends like a credential, however it is written", () => {
    expect(
      withoutCredentials({
        env: { OPENAI_API_KEY: "k1", GITHUB_TOKEN: "k2" },
        openaiApiKey: "k3",
        "db-password": "k4",
      }),
    ).toEqual({
      env: {
        OPENAI_API_KEY: credentialOmitted,
        GITHUB_TOKEN: credentialOmitted,
      },
      openaiApiKey: credentialOmitted,
      "db-password": credentialOmitted,
    });
  });

  it("leaves a model's special tokens and token counts as they were", () => {
    const record = {
      eos_token: "</s>",
      pad_token: "<pad>",
      maxTokens: 4096,
      max_tokens: "4096",
    };

    expect(withoutCredentials(record)).toEqual(record);
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
    ['{"OPENAI_API_KEY": "k1"}', `{"OPENAI_API_KEY": "${credentialOmitted}"}`],
    ["x-api-key: k1a2b3", `x-api-key: ${credentialOmitted}`],
    [
      'curl -H "X-Goog-Api-Key: k1a2b3" https://example.com',
      `curl -H "X-Goog-Api-Key: ${credentialOmitted}" https://example.com`,
    ],
    ["MOONSHOT_API_KEY=k1a2b3", `MOONSHOT_API_KEY=${credentialOmitted}`],
    [
      "OPENAI_API_KEY=sk-0123456789abcdef0123",
      `OPENAI_API_KEY=${credentialOmitted}`,
    ],
    [
      'export GITHUB_TOKEN="k1a2b3"',
      `export GITHUB_TOKEN="${credentialOmitted}"`,
    ],
    [
      '$env:DEEPSEEK_API_KEY = "k1a2b3"',
      `$env:DEEPSEEK_API_KEY = "${credentialOmitted}"`,
    ],
    [
      "https://api.example.com/v1?api_key=k1a2b3&q=odyssey",
      `https://api.example.com/v1?api_key=${credentialOmitted}&q=odyssey`,
    ],
    [`key AIza${"A1b2C3d4e5".repeat(3)}F6g7h`, `key ${credentialOmitted}`],
    [`token hf_${"A1b2C3d4e5".repeat(3)}F6g7`, `token ${credentialOmitted}`],
  ])("removes %s", (text, expected) => {
    expect(textWithoutCredentials(text)).toBe(expected);
  });

  it.each([
    "mysql --password=hunter2 -u root",
    "x-api-key: k1a2b3",
    "MOONSHOT_API_KEY=k1a2b3",
    "https://api.example.com/v1?api_key=k1a2b3",
  ])("removes %s the same way when it runs again", (text) => {
    const once = textWithoutCredentials(text);

    expect(textWithoutCredentials(once)).toBe(once);
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
    "const token = getToken();",
    "apiKey: string;",
    'OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")',
    "MAX_TOKENS=4096",
    '{"eos_token": "</s>", "max_tokens": 4096}',
    "https://example.com/search?q=token",
  ])("leaves %s alone", (text) => {
    expect(textWithoutCredentials(text)).toBe(text);
  });
});
