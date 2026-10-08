/** What the usage page shows, and what it leaves out. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UsageState } from "@zhiyin/contract";
import { UsagePanel } from "./UsagePanel.js";

/** A range of usage with the given totals. */
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
  conversations: [],
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
      within(panel).getByRole("list", { name: "Requests by day" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("img", { name: "Usage share by model" }),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole("table")).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: "30 days" }));
    expect(within(panel).getByText("5,238")).toBeInTheDocument();
    expect(within(panel).getByText("$64.90")).toBeInTheDocument();
  });

  it("says what each conversation cost, opening one that is still there, and naming one deleted and the requests outside any", () => {
    const onOpenConversation = vi.fn();
    const ready = usage.status === "ready" ? usage.ranges["7"] : undefined;
    render(
      <UsagePanel
        availability={{
          status: "ready",
          costSource: "provider-reported",
          ranges: {
            "7": {
              ...ready!,
              conversations: [
                {
                  conversationId: "task-1",
                  requests: 40,
                  pricedRequests: 38,
                  costUsd: 1.25,
                },
                {
                  conversationId: "gone",
                  requests: 3,
                  pricedRequests: 3,
                  costUsd: 0.4,
                },
                { requests: 2, pricedRequests: 2, costUsd: 0.02 },
              ],
            },
            "30": usage.status === "ready" ? usage.ranges["30"] : ready!,
          },
        }}
        conversations={[{ id: "task-1", title: "Quarterly report" }]}
        onOpenConversation={onOpenConversation}
        onClose={() => undefined}
      />,
    );

    const list = screen.getByRole("list", { name: "Cost by conversation" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      "Quarterly report40 requests, 38 priced$1.25",
      "A deleted conversation3 requests$0.40",
      "Outside any conversation2 requests$0.02",
    ]);
    fireEvent.click(
      within(list).getByRole("button", { name: "Open Quarterly report" }),
    );
    expect(onOpenConversation).toHaveBeenCalledWith("task-1");
    expect(within(list).getAllByRole("button")).toHaveLength(1);
  });

  it("opens a conversation from anywhere on its row", () => {
    const onOpenConversation = vi.fn();
    const ready = usage.status === "ready" ? usage.ranges["7"] : undefined;
    render(
      <UsagePanel
        availability={{
          status: "ready",
          costSource: "provider-reported",
          ranges: {
            "7": {
              ...ready!,
              conversations: [
                {
                  conversationId: "task-1",
                  requests: 1_240,
                  pricedRequests: 1_240,
                  costUsd: 3.5,
                },
              ],
            },
            "30": ready!,
          },
        }}
        conversations={[{ id: "task-1", title: "Quarterly report" }]}
        onOpenConversation={onOpenConversation}
        onClose={() => undefined}
      />,
    );

    const row = screen.getByRole("button", { name: "Open Quarterly report" });
    expect(row).toHaveTextContent("1,240 requests");
    expect(row).toHaveTextContent("$3.50");
  });

  /** Cents for anything worth a cent; below that, enough places to see it. */
  it("shows amounts of a cent or more in cents, and smaller ones to two significant places", () => {
    const ready = usage.status === "ready" ? usage.ranges["7"] : undefined;
    render(
      <UsagePanel
        availability={{
          status: "ready",
          costSource: "provider-reported",
          ranges: {
            "7": {
              ...ready!,
              conversations: [
                {
                  conversationId: "a",
                  requests: 3,
                  pricedRequests: 3,
                  costUsd: 0.4,
                },
                {
                  conversationId: "b",
                  requests: 2,
                  pricedRequests: 2,
                  costUsd: 0.01,
                },
                {
                  conversationId: "c",
                  requests: 1,
                  pricedRequests: 1,
                  costUsd: 0.000921,
                },
              ],
            },
            "30": ready!,
          },
        }}
        onClose={() => undefined}
      />,
    );

    const list = screen.getByRole("list", { name: "Cost by conversation" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((row) => row.textContent?.match(/\$[\d.]+$/)?.[0]),
    ).toEqual(["$0.40", "$0.01", "$0.00092"]);
  });

  it("names each model by its catalogue name, keeping its id on hover", async () => {
    render(
      <UsagePanel
        availability={usage}
        onListModels={async () => ({
          status: "ready",
          models: [
            {
              id: "z-ai/glm-5.3-flash",
              name: "Z.ai: GLM 5.3 Flash",
              contextWindow: 200_000,
              inputUsdPerMillion: 0.075,
              outputUsdPerMillion: 0.25,
              acceptsImages: false,
              reasoning: true,
            },
          ],
        })}
        onClose={() => undefined}
      />,
    );

    const legend = screen.getByRole("list", { name: "Requests by model" });
    const named = await within(legend).findByText("Z.ai: GLM 5.3 Flash");
    expect(named).toHaveAttribute("data-tip", "z-ai/glm-5.3-flash");
    // A model the catalogue does not list is named by its id.
    expect(within(legend).getByText("anthropic/claude-sonnet-5")).toBeVisible();
  });

  it("says each day's requests and cost on focus, moving between days with the arrow keys", () => {
    render(<UsagePanel availability={usage} onClose={() => undefined} />);

    const requests = screen.getByRole("list", { name: "Requests by day" });
    const [first, second] = within(requests).getAllByRole("listitem");
    expect(first).toHaveAccessibleName("Tue 1 Sep: 183 requests");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
    first!.focus();
    fireEvent.keyDown(first!, { key: "ArrowRight" });
    expect(second).toHaveFocus();

    const costs = screen.getByRole("list", { name: "Cost by day" });
    expect(within(costs).getAllByRole("listitem")[0]).toHaveAccessibleName(
      "Tue 1 Sep: $2.63",
    );
  });

  it("puts each total in the figures above the charts, not again in the charts", () => {
    render(<UsagePanel availability={usage} onClose={() => undefined} />);

    expect(screen.getAllByText("$18.42")).toHaveLength(1);
    expect(screen.queryByText(/total$/)).toBeNull();
  });
});
