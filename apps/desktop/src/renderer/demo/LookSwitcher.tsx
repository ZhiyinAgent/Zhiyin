import { useState } from "react";
import { lookIds, lookStrengths, type LookChoice } from "@zhiyin/contract";
import { dressWindow, lookInAddress } from "../ui/app/index.js";
import { ChoiceSwitch, lookWords, strengthNames } from "../ui/shared/index.js";

/**
 * The look and strength the lab is drawn in, so every entry can be reviewed
 * in each. The choice stays in the address, so a reload keeps it.
 */
export function LookSwitcher() {
  const [look, setLook] = useState(() => lookInAddress(location.search));

  function wear(choice: LookChoice) {
    setLook(choice);
    dressWindow(document.documentElement, choice);
    const query = new URLSearchParams(location.search);
    query.set("look", choice.look);
    query.set("strength", choice.strength);
    window.history.replaceState(null, "", `?${query}`);
  }

  return (
    <div className="lab__looks">
      <ChoiceSwitch
        aria-label="Look"
        choices={lookIds.map((value) => ({
          value,
          label: lookWords[value].name,
        }))}
        value={look.look}
        onChange={(value) => wear({ ...look, look: value })}
      />
      <ChoiceSwitch
        aria-label="Strength"
        choices={lookStrengths.map((value) => ({
          value,
          label: strengthNames[value],
        }))}
        value={look.strength}
        onChange={(value) => wear({ ...look, strength: value })}
      />
    </div>
  );
}
