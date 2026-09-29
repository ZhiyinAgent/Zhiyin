# 0057. Permission requests show effects before optional guidance

Status: accepted

## Context

The approval card grew a redundant file-effect sentence, a permanently open
denial-guidance field, and a raw-call expander. The controls made a common
decision harder to scan while giving uncommon paths equal space. A person
still needs to inspect the exact command or inputs before allowing an action.

Assumptions this decision depends on:

- File inspections can name each created or edited file and supply a reviewable
  difference. Extra effects, such as creating a parent folder, are declared
  structurally rather than inferred from a sentence.
- The action inspector remains available after the decision and can show raw
  call syntax for technical review.
- Guidance on a denial must be collected before that decision reaches the
  running model.

## Decision

The permission request leads with the action and a concise, structured account
of what it will run or change. A file row says whether it creates or edits the
file, names its path, and offers the proposed difference. The model's reason
stays attributed as a claim. Shell commands and other consequential inputs
remain readable in full. Raw tool-call syntax lives under Technical details
in the resulting action card.

Choosing Deny opens a short confirmation step with optional guidance. Back
returns to the original decision. Guidance is sent with the denial; the main
card never reserves space for that uncommon path.

## Consequences

- Denial takes a second click. That makes room for a correction without
  accidentally sending an empty denial while the person is writing it.
- A person deciding on a file change sees the type, path, and difference at
  once. Technical readers can still inspect the raw call afterward.

Named renderer regressions are `labels a new file and its new folder inside
what will change`, `offers guidance only after Deny, while allowing a denial
without text`, and `draws what a tool reported in the shapes the tool named`.
