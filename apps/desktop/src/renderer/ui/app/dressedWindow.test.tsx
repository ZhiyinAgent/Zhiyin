import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LookChoice } from "@zhiyin/contract";
import {
  dressWindow,
  lookInAddress,
  useDressedWindow,
} from "./dressedWindow.js";

function Window({ look }: { look: LookChoice | undefined }) {
  useDressedWindow(look);
  return null;
}

const root = document.documentElement;
const worn = () => ({
  look: root.getAttribute("data-look"),
  strength: root.getAttribute("data-look-strength"),
});

afterEach(() => {
  root.removeAttribute("data-look");
  root.removeAttribute("data-look-strength");
});

describe("the look the window wears", () => {
  it("is read from the page's address, where the main process puts it before the first frame", () => {
    expect(lookInAddress("?look=neutral&strength=vivid")).toEqual({
      look: "neutral",
      strength: "vivid",
    });
    expect(lookInAddress("?restarted=1&look=ink&strength=subtle")).toEqual({
      look: "ink",
      strength: "subtle",
    });
  });

  it("is the default look wherever the address names none, or one not on the list", () => {
    expect(lookInAddress("")).toEqual({ look: "ink", strength: "default" });
    expect(lookInAddress("?look=sepia&strength=vivid")).toEqual({
      look: "ink",
      strength: "vivid",
    });
    expect(lookInAddress("?look=neutral&strength=loud")).toEqual({
      look: "neutral",
      strength: "default",
    });
  });

  it("is put on the page's root, where every stylesheet reads it", () => {
    dressWindow(root, { look: "neutral", strength: "subtle" });
    expect(worn()).toEqual({ look: "neutral", strength: "subtle" });
  });

  it("keeps the look from the address until the core says which, then follows each choice", () => {
    dressWindow(root, { look: "neutral", strength: "vivid" });
    const { rerender } = render(<Window look={undefined} />);
    expect(worn()).toEqual({ look: "neutral", strength: "vivid" });

    rerender(<Window look={{ look: "ink", strength: "default" }} />);
    expect(worn()).toEqual({ look: "ink", strength: "default" });

    rerender(<Window look={{ look: "ink", strength: "subtle" }} />);
    expect(worn()).toEqual({ look: "ink", strength: "subtle" });
  });
});
