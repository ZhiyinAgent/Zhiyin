import { describe, expect, it } from "vitest";
import {
  componentProblems,
  lookupProblems,
  problemsInRenderer,
  stylesheetProblems,
} from "./style-ownership.mjs";

describe("renderer style ownership", () => {
  it("rejects a global stylesheet defining a module's class", () => {
    expect(
      stylesheetProblems("foundations.css", ".approval { padding: 0; }"),
    ).toEqual([expect.stringContaining(".approval")]);
  });

  it("allows a global stylesheet the theme, the reset and the shared basics", () => {
    expect(
      stylesheetProblems(
        "foundations.css",
        [
          ":root { --zy-text: var(--zy-ink); }",
          "* { box-sizing: border-box; }",
          ".button:hover, .text-button svg { opacity: 0.5; }",
          "@media (prefers-reduced-motion: reduce) { *, *::before { transition-duration: 0.01ms !important; } }",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("rejects a module stylesheet reaching another module's class", () => {
    expect(
      stylesheetProblems(
        "actions.module.css",
        ".approval :global(.composer) { gap: 0; }",
      ),
    ).toEqual([expect.stringContaining(".composer")]);
  });

  it("allows a module stylesheet its own classes and the shared basics", () => {
    expect(
      stylesheetProblems(
        "actions.module.css",
        "/* :global(.composer) in prose is not a rule */\n.approval :global(.button):disabled { opacity: 0.4; }",
      ),
    ).toEqual([]);
  });

  it("rejects a module stylesheet styling anything but its own elements", () => {
    expect(
      stylesheetProblems("actions.module.css", "body { display: none; }"),
    ).toEqual([expect.stringContaining("body")]);
  });

  it("rejects a module stylesheet reaching out through a global selector without parentheses", () => {
    expect(
      stylesheetProblems(
        "actions.module.css",
        ".approval :global .composer { gap: 0; }",
      ),
    ).toEqual([expect.stringContaining(".composer")]);
  });

  it("rejects a module stylesheet pulling in another module's styles", () => {
    expect(
      stylesheetProblems(
        "actions.module.css",
        '@import "../conversation/conversation.module.css";\n.approval { gap: 0; }',
      ),
    ).toEqual([expect.stringContaining("conversation.module.css")]);
    expect(
      stylesheetProblems(
        "actions.module.css",
        '.approval { composes: bubble from "../conversation/conversation.module.css"; }',
      ),
    ).toEqual([expect.stringContaining("conversation.module.css")]);
  });

  it("allows a module stylesheet its own elements, its animations and its media queries", () => {
    expect(
      stylesheetProblems(
        "actions.module.css",
        [
          ".approval h3 { margin: 0; }",
          ".approval > div + div { gap: 4px; }",
          "@media (max-width: 700px) { .approval { gap: 2px; } }",
          "@keyframes approval-in { from { opacity: 0; } to { opacity: 1; } }",
          ".approval { animation: approval-in 0.2s; }",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("rejects a component writing a class name its module does not style", () => {
    expect(
      componentProblems(
        "Approval.tsx",
        'export const Approval = () => <div className="approval" />;',
      ),
    ).toEqual([expect.stringContaining("approval")]);
  });

  it("allows a component its module's styles, the shared basics, and states it compares against", () => {
    expect(
      componentProblems(
        "Approval.tsx",
        [
          'import styles from "./actions.module.css";',
          "export const Approval = ({ kind }: { kind: string }) => (",
          '  <button className={`${styles.approval} button button--accent${kind === "open" ? ` ${styles["approval--open"]}` : ""}`} />',
          ");",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  /** Without this, a renamed or deleted rule leaves its element unstyled. */
  it("rejects a component looking up a class its stylesheet does not define", () => {
    expect(
      lookupProblems(
        "Approval.tsx",
        [
          'import styles from "./actions.module.css";',
          'export const Approval = () => <p className={styles["approval__message"]} />;',
        ].join("\n"),
        { "./actions.module.css": ".approval { gap: 0; }" },
      ),
    ).toEqual([expect.stringContaining("approval__message")]);
  });

  it("allows a component its stylesheet's classes, and a name it builds as it runs", () => {
    expect(
      lookupProblems(
        "Approval.tsx",
        [
          'import styles from "./actions.module.css";',
          "export const Approval = ({ kind }: { kind: string }) => (",
          "  <div className={`${styles.approval} ${styles[`approval--${kind}`]}`}>",
          '    <p className={styles["approval__text"]} />',
          "  </div>",
          ");",
        ].join("\n"),
        {
          "./actions.module.css":
            "/* .approval__gone */ .approval { gap: 0; }\n@media (max-width: 700px) { .approval .approval__text { gap: 2px; } }",
        },
      ),
    ).toEqual([]);
  });

  it("holds every renderer stylesheet and component to these rules", async () => {
    expect(await problemsInRenderer()).toEqual([]);
  });
});
