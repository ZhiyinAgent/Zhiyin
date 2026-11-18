import { useEffect } from "react";
import { defaultLook, type LookChoice } from "@zhiyin/contract";
import { isLookId, isLookStrength } from "@zhiyin/value-checks";

/**
 * The look the main process put in the page's address, so the first frame
 * already wears it. Whatever is missing or not on the list is the default's.
 */
export function lookInAddress(search: string): LookChoice {
  const query = new URLSearchParams(search);
  const look = query.get("look");
  const strength = query.get("strength");
  return {
    look: isLookId(look) ? (look as LookChoice["look"]) : defaultLook.look,
    strength: isLookStrength(strength)
      ? (strength as LookChoice["strength"])
      : defaultLook.strength,
  };
}

/** Puts a look on an element; every look's stylesheet selects by it. */
export function dressWindow(element: HTMLElement, choice: LookChoice): void {
  element.setAttribute("data-look", choice.look);
  element.setAttribute("data-look-strength", choice.strength);
}

/**
 * Dresses the page in the look the core says, once it has said one. Until
 * then the page keeps the look its address gave it.
 */
export function useDressedWindow(choice: LookChoice | undefined): void {
  const look = choice?.look;
  const strength = choice?.strength;
  useEffect(() => {
    if (look && strength)
      dressWindow(document.documentElement, { look, strength });
  }, [look, strength]);
}
