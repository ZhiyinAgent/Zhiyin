/** What the usage page shows, and what it leaves out. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { UsageState } from "@zhiyin/contract";
import { UsagePanel } from "./UsagePanel.js";

/** Two ranges with the same totals the page used to be shown in the demo. */
const range = (days: 7 | 30, requests: number, costUsd: number) => ({
  days,
  requests,
  inputTokens: days * 1_000_000,
  outputTokens: days * 400_000,
  costUsd,
  pricedRequests: requests,
  activity: Array.from({ length: days }, (_, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    requests: Math.round(requests / days),
    costUsd: Number((costUsd / days).toFixed(6)),
  })),
  // Two models, so no single row carries the range's whole cost.
  models: [
    {
      model: "z-ai/glm-5.3-flash",
      requests: Math.round(requests * 0.6),
      inputTokens: days * 600_000,
      outputTokens: days * 240_000,
      costUsd: Number((costUsd * 0.6).toFixed(2)),
    },
    {
      model: "anthropic/claude-sonnet-5",
      requests: requests - Math.round(requests * 0.6),
      inputTokens: days * 400_000,
      outputTokens: days * 160_000,
      costUsd: Number((costUsd * 0.4).toFixed(2)),
    },
  ],
});

const usage: UsageState = {
  status: "ready",
  costSource: "provider-reported",
  ranges: { "7": range(7, 1_284, 18.42), "30": range(30, 5_238, 64.9) },
};

describe("UsagePanel", () => {
  it("uses visual summaries and updates when the range changes", () => {
    render(<UsagePanel availability={usage} onClose={() => undefined} />);

    const panel = screen.getByRole("region", { name: "Usage overview" });
    expect(within(panel).getByText("1,284")).toBeInTheDocument();
    expect(
      within(panel).getByRole("img", {
        name: "Requests over the last 7 days",
      }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("img", { name: "Usage share by model" }),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole("table")).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: "30 days" }));
    expect(within(panel).getByText("5,238")).toBeInTheDocument();
    expect(within(panel).getByText("$64.90")).toBeInTheDocument();
  });
});
