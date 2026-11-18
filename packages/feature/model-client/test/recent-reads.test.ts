/**
 * What an account reads of its provider's lists is shared for a minute, so
 * the picker and the chosen model's description download it once.
 */

import { describe, expect, it } from "vitest";
import { recentReads, sharedForMs } from "../src/recent-reads.js";
import type { CatalogFetch } from "../src/provider.js";

function provider(answers: { ok: boolean; status: number; body: unknown }[]) {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const fetcher: CatalogFetch = async (url, init) => {
    asked.push({ url, headers: { ...init.headers } });
    const answer = answers[Math.min(asked.length, answers.length) - 1]!;
    return {
      ok: answer.ok,
      status: answer.status,
      json: async () => answer.body,
    };
  };
  return { asked, fetcher };
}

const list = { ok: true, status: 200, body: { data: ["a"] } };
const key = { headers: { Authorization: "Bearer one" } };

describe("an account's reads of its provider's lists", () => {
  it("share one answer within a minute, and read again after it", async () => {
    let clock = 0;
    const { asked, fetcher } = provider([list]);
    const reads = recentReads(fetcher, () => clock);

    const first = await reads("https://lists.example/models", key);
    clock = sharedForMs - 1;
    const second = await reads("https://lists.example/models", key);

    expect(await first.json()).toEqual({ data: ["a"] });
    expect(await second.json()).toEqual({ data: ["a"] });
    expect(asked).toHaveLength(1);

    clock = sharedForMs * 2;
    await reads("https://lists.example/models", key);
    expect(asked).toHaveLength(2);
  });

  it("read again after a refusal, and after an answer that could not be read", async () => {
    const refused = { ok: false, status: 503, body: {} };
    const { asked, fetcher } = provider([refused, list]);
    const reads = recentReads(fetcher, () => 0);

    expect((await reads("https://lists.example/models", key)).ok).toBe(false);
    expect(
      await (await reads("https://lists.example/models", key)).json(),
    ).toEqual({ data: ["a"] });
    expect(asked).toHaveLength(2);

    let reading = 0;
    const unreadable = recentReads(
      async () => {
        reading += 1;
        return {
          ok: true,
          status: 200,
          json: async () => {
            if (reading === 1) throw new SyntaxError("Unexpected end of JSON");
            return { data: [] };
          },
        };
      },
      () => 0,
    );
    await expect(
      (await unreadable("https://lists.example/models", key)).json(),
    ).rejects.toThrow("Unexpected end of JSON");
    expect(
      await (await unreadable("https://lists.example/models", key)).json(),
    ).toEqual({ data: [] });
  });

  it("keep a read with another key, and a request that is not a plain read, apart", async () => {
    const { asked, fetcher } = provider([list]);
    const reads = recentReads(fetcher, () => 0);

    await reads("https://lists.example/models", key);
    await reads("https://lists.example/models", {
      headers: { Authorization: "Bearer two" },
    });
    await reads("https://lists.example/check", {
      ...key,
      method: "POST",
      body: "{}",
    });
    await reads("https://lists.example/check", {
      ...key,
      method: "POST",
      body: "{}",
    });

    expect(
      asked.map((each) => [each.url, each.headers["Authorization"]]),
    ).toEqual([
      ["https://lists.example/models", "Bearer one"],
      ["https://lists.example/models", "Bearer two"],
      ["https://lists.example/check", "Bearer one"],
      ["https://lists.example/check", "Bearer one"],
    ]);
  });
});
