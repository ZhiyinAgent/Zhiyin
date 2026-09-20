# 0025. Reasoning controls use a bulb and effort slider

Status: accepted

## Context

The user rejected the visible switch and dropdown and supplied references for a
light-bulb button and a compact stepped slider. This supersedes the control
presentation in ADR 0024; its provider and persistence contracts still apply.

## Decision

The composer shows one bulb, illuminated when reasoning is enabled. Clicking it
opens an anchored panel with the current level, reset, and ascending supported
efforts. Off is a stop only when the model permits it. Reset restores the model's
declared default. When the default effort is unknown, Auto preserves that choice.

The panel renders outside the scrolling input container to avoid clipping and
stays within the horizontal viewport. The native slider provides keyboard effort
selection. Escape returns focus to the bulb; outside interaction dismisses the
panel. Running or unavailable settings disable the bulb.

## Assumptions and limits

Effort levels are discrete model settings, not a proportional token budget.
The interface uses the existing theme. DOM behavior tests cover selection and
dismissal; visual acceptance remains outstanding while local browser access is
blocked, as recorded in the reasoning coverage task.
