import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActionDetail, TaskAction } from "@zhiyin/contract";
import { ActionHistory } from "../action-history/ActionHistory.js";
import { TurnChecks, turnChecks } from "./TurnChecks.js";

const checks = (
  items: Extract<ActionDetail, { kind: "checks" }>["items"],
  note?: string,
): ActionDetail => ({
  kind: "checks",
  label: "Requirements in requirements.json",
  items,
  ...(note ? { note } : {}),
});

const build = (
  id: string,
  details: ActionDetail[],
  status: TaskAction["status"] = "completed",
): TaskAction => ({
  sequence: Number(id.replace(/\D/g, "")) || 1,
  id,
  action: "Build the CAD script",
  target: "car.py",
  status,
  details,
});

describe("the checks a turn's tools measured, under its answer", () => {
  it("shows the last build's verdict on each requirement, in words beside its mark", () => {
    render(
      <TurnChecks
        checks={turnChecks([
          build("b1", [checks([{ label: "R1", holds: false }])]),
          build("b2", [
            checks(
              [
                {
                  label: "R1 · Fits a 200 mm cube",
                  holds: true,
                  note: "180 × 90 × 60 mm; 20 mm to spare",
                },
                {
                  label: "R2 · Axle goes into the wheel",
                  holds: false,
                  note: "it meets Wheel_FR 76 mm short of its place",
                },
                { label: "R3", holds: null, note: "no part is named Lid" },
              ],
              "R4 failed in the last build and is no longer in requirements.json.",
            ),
          ]),
        ])}
      />,
    );

    const card = screen.getByRole("region", {
      name: "Requirements in requirements.json: 1 of 2 checked holds",
    });
    const rows = within(card).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(
      "HoldsR1 · Fits a 200 mm cube180 × 90 × 60 mm; 20 mm to spare",
    );
    expect(rows[1]).toHaveTextContent(
      "FailsR2 · Axle goes into the wheelit meets Wheel_FR 76 mm short of its place",
    );
    expect(rows[2]).toHaveTextContent("Not checkedR3no part is named Lid");
    expect(
      within(card).getByText(
        "R4 failed in the last build and is no longer in requirements.json.",
      ),
    ).toBeVisible();
  });

  it("keeps the last verdict of each list when a turn checked more than one", () => {
    const other: ActionDetail = {
      kind: "checks",
      label: "Requirements in stand.json",
      items: [{ label: "S1", holds: true }],
    };
    const found = turnChecks([
      build("b1", [checks([{ label: "R1", holds: false }])]),
      build("b2", [other]),
      build("b3", [checks([{ label: "R1", holds: true }])]),
    ]);

    expect(found.map((one) => one.label)).toEqual([
      "Requirements in stand.json",
      "Requirements in requirements.json",
    ]);
    expect(found[1]?.items[0]?.holds).toBe(true);
  });

  it("leaves out the checks of an action that did not finish", () => {
    expect(
      turnChecks([
        build("b1", [checks([{ label: "R1", holds: true }])], "failed"),
      ]),
    ).toEqual([]);
  });

  it("draws the same list when the action is inspected", () => {
    render(
      <ActionHistory
        actions={[
          build("b1", [
            checks([
              { label: "R1", holds: true, note: "1 mm to spare" },
              { label: "R2", holds: false },
            ]),
          ]),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect action" }));

    const inspector = screen.getByRole("dialog");
    expect(
      within(inspector).getByText("Requirements in requirements.json"),
    ).toBeVisible();
    const rows = within(inspector).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("HoldsR11 mm to spare");
    expect(rows[1]).toHaveTextContent("FailsR2");
  });
});
