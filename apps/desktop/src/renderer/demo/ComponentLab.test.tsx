import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { componentCatalog } from "./componentCatalog.js";
import { ComponentLab } from "./ComponentLab.js";

describe("ComponentLab", () => {
  // Renders every component the application has, in one pass. It grows with
  // the catalog and is slow by design rather than by accident.
  it(
    "renders every production component catalog entry",
    { timeout: 30_000 },
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
