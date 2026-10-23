/** Every page opened from the sidebar's menu wears the same heading. */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InstructionsSettings } from "../instructions/index.js";
import { AppSettings } from "../settings/index.js";
import { SurfacePanel } from "../shared/index.js";

/** The heading's header as the shared page draws it. */
function sharedHeader(): string {
  const { unmount } = render(
    <SurfacePanel
      label="Page"
      eyebrow={null}
      title="Page"
      closeLabel="Close"
      onClose={() => undefined}
    >
      {null}
    </SurfacePanel>,
  );
  const header = screen.getByRole("heading", { level: 1 }).closest("header");
  const className = header?.className ?? "";
  unmount();
  return className;
}

describe("a page's heading", () => {
  it("is the shared page heading on Settings and on Custom instructions", () => {
    const shared = sharedHeader();
    expect(shared).not.toBe("");

    for (const page of [
      <AppSettings
        key="settings"
        notifications
        onNotifications={async () => undefined}
        onClose={() => undefined}
      />,
      <InstructionsSettings
        key="instructions"
        saved=""
        onSave={async () => undefined}
        onClose={() => undefined}
      />,
    ]) {
      const { unmount } = render(page);
      const headings = screen.getAllByRole("heading", { level: 1 });

      expect(headings).toHaveLength(1);
      expect(headings[0]!.closest("header")?.className).toContain(shared);
      unmount();
    }
  });
});
