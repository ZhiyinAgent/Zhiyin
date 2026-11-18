/**
 * The provider and model lists are one Tab stop each: Tab reaches the chosen
 * entry, and the arrow keys, Home and End move among the rest. Moving does
 * not choose; Enter or Space does, since choosing a provider loads its models.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ModelCatalog, ProviderSummary } from "@zhiyin/contract";
import { ModelList } from "./ModelList.js";
import { ProviderColumn } from "./ProviderColumn.js";

const provider = (
  id: string,
  name: string,
  unavailable?: string,
): ProviderSummary => ({
  id,
  name,
  ...(unavailable ? { unavailable } : {}),
  accounts: [],
});

const providers = [
  provider("anthropic", "Anthropic"),
  provider("deepseek", "DeepSeek"),
  provider("lab", "Lab", "Its requests are not connected yet."),
  provider("mistral", "Mistral"),
];

const catalog: ModelCatalog = {
  status: "ready",
  models: ["one", "two", "three"].map((id) => ({
    id: `lab/${id}`,
    name: `Model ${id}`,
    contextWindow: 128_000,
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 2,
    acceptsImages: false,
    reasoning: false,
  })),
};

function radios(group: string) {
  return within(screen.getByRole("radiogroup", { name: group })).getAllByRole(
    "radio",
  );
}

/** The entries Tab can reach in a group. */
const tabStops = (group: string) =>
  radios(group).filter((radio) => radio.tabIndex === 0);

describe("the provider list", () => {
  it("is one Tab stop, on the chosen provider", () => {
    render(
      <ProviderColumn
        providers={providers}
        target={{ provider: "deepseek" }}
        onChoose={() => undefined}
      />,
    );

    expect(tabStops("Provider").map((radio) => radio.textContent)).toEqual([
      "DeepSeek",
    ]);
  });

  it("is reached on its first provider when none is chosen", () => {
    render(
      <ProviderColumn
        providers={providers}
        target={undefined}
        onChoose={() => undefined}
      />,
    );

    expect(tabStops("Provider").map((radio) => radio.textContent)).toEqual([
      "Anthropic",
    ]);
  });

  it("moves with the arrow keys past a provider that cannot be chosen, without choosing", () => {
    const onChoose = vi.fn();
    render(
      <ProviderColumn
        providers={providers}
        target={{ provider: "deepseek" }}
        onChoose={onChoose}
      />,
    );
    const [anthropic, deepseek, , mistral] = radios("Provider");

    deepseek!.focus();
    fireEvent.keyDown(deepseek!, { key: "ArrowDown" });
    expect(mistral).toHaveFocus();
    fireEvent.keyDown(mistral!, { key: "ArrowDown" });
    expect(anthropic).toHaveFocus();
    fireEvent.keyDown(anthropic!, { key: "ArrowUp" });
    expect(mistral).toHaveFocus();
    fireEvent.keyDown(mistral!, { key: "Home" });
    expect(anthropic).toHaveFocus();
    fireEvent.keyDown(anthropic!, { key: "End" });
    expect(mistral).toHaveFocus();

    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.click(mistral!);
    expect(onChoose).toHaveBeenCalledWith({ provider: "mistral" });
  });
});

describe("the model list", () => {
  const list = (selected: string) => (
    <ModelList
      catalog={catalog}
      loading={false}
      selected={selected}
      query=""
      onQueryChange={() => undefined}
      activeFilters={[]}
      onToggleFilter={() => undefined}
      order="name"
      onOrderChange={() => undefined}
      onSelect={() => undefined}
    />
  );

  it("is one Tab stop, on the chosen model, and moves with the arrow keys", () => {
    render(list("lab/one"));
    // Listed by name: one, three, two.
    const [one, three, two] = radios("Models");

    expect(tabStops("Models")).toEqual([one]);
    one!.focus();
    fireEvent.keyDown(one!, { key: "ArrowRight" });
    expect(three).toHaveFocus();
    fireEvent.keyDown(three!, { key: "End" });
    expect(two).toHaveFocus();
    fireEvent.keyDown(two!, { key: "ArrowDown" });
    expect(one).toHaveFocus();
  });

  it("is reached on its first model when the chosen one is not listed", () => {
    render(list("elsewhere/model"));

    expect(tabStops("Models")).toEqual([radios("Models")[0]]);
  });
});
