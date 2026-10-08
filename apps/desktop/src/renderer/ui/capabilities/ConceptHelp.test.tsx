import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PluginComponentState, PluginState } from "@zhiyin/contract";
import { PluginDetail } from "./PluginDetail.js";

const component = (
  kind: PluginComponentState["kind"],
  name: string,
): PluginComponentState => ({
  id: `research/${name}`,
  kind,
  name,
  description: `${name} described.`,
  enabled: true,
  status: "ready",
  editing: "override",
});

const research: PluginState = {
  id: "research",
  name: "Deep Research",
  version: "1.0.0",
  description: "Find and weigh sources.",
  category: "Research",
  publisher: "Zhiyin",
  source: "built-in",
  editing: "override",
  rollbackAvailable: false,
  enabled: true,
  status: "ready",
  defaultPrompts: [],
  components: [
    component("skill", "triangulate"),
    component("specialist", "fact-checker"),
    component("connection", "Tavily"),
  ],
};

function show() {
  render(
    <PluginDetail
      plugin={research}
      actions={{
        onToggle: () => undefined,
        onOpen: () => undefined,
        onInstall: () => undefined,
        onRecheck: () => undefined,
      }}
      management={{
        pending: undefined,
        onToggle: () => undefined,
        onUpdate: () => undefined,
        onRollback: () => undefined,
        onRemove: async () => undefined,
        onNewComponent: () => undefined,
      }}
    />,
  );
}

function explanation(topic: string) {
  const button = screen.getByRole("button", { name: `About ${topic}` });
  fireEvent.click(button);
  return document.getElementById(button.getAttribute("aria-controls")!)!;
}

describe("what skills, specialists and connectors are", () => {
  it("is said beside each kind, in two sentences: what it is and whether it needs setting up", () => {
    show();

    expect(explanation("skills").querySelector("p")).toHaveTextContent(
      "A skill is written guidance Zhiyin follows for one kind of work, such as checking citations. There is nothing to set up: Zhiyin reads one when a conversation needs it.",
    );
    expect(explanation("specialists").querySelector("p")).toHaveTextContent(
      "A specialist is a helper Zhiyin can hand part of a task to, such as a fact-checker. There is nothing to set up: Zhiyin decides when one would help.",
    );
    expect(explanation("connectors").querySelector("p")).toHaveTextContent(
      "A connector lets Zhiyin use another service or program, such as GitHub, a web search or a browser. Each one is optional: set one up only when you want Zhiyin to use it.",
    );
  });

  it("keeps what each can reach, and how to stop it, under Details", () => {
    show();

    expect(explanation("skills")).toHaveTextContent(
      "A skill reaches nothing by itself; it only changes how Zhiyin works. Switch one off to stop Zhiyin using it.",
    );
    expect(explanation("specialists")).toHaveTextContent(
      "A specialist works under Zhiyin's own rules: what it would change asks for your approval as Zhiyin's actions do, and some can only read. Switch one off to stop Zhiyin using it.",
    );
    expect(explanation("connectors")).toHaveTextContent(
      "A connector to an online service needs a key you make on that service, which Zhiyin keeps in Windows Credential Manager. Zhiyin asks before each action it takes through such a connector, unless you allow that action for the conversation; switching it on allows nothing by itself.",
    );
  });
});
