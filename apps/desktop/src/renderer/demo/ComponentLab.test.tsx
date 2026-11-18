import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { componentCatalog } from "./componentCatalog.js";
import { ComponentLab } from "./ComponentLab.js";

describe("ComponentLab", () => {
  // Renders every component the application has, in one pass. It grows with
  // the catalog and is slow by design rather than by accident: about 25 s on
  // a desktop and 40 s on GitHub's CI runner, so its limit leaves room for both.
  it(
    "renders every production component catalog entry",
    { timeout: 90_000 },
    () => {
      render(<ComponentLab />);

      for (const entry of componentCatalog) {
        expect(
          screen.getByRole("heading", { name: entry.title }),
        ).toBeVisible();
      }
    },
  );
});
