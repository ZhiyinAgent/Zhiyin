# 0063. The working model keeps its own plan, and nothing judges it

Status: accepted; supersedes ADR 0053; supersedes the plan parts of ADR 0052
and ADR 0062, the planner and criteria of ADR 0008, and the judgement seam of
ADR 0046

## Context

Each turn began with a separate planner request that wrote items with
criteria. The working model reported progress with `update_plan`, and a claim
of done had to cite this turn's call ids. A judge with its own reading rounds
checked each claimed item and every open one at the end of the turn. Every
tool took an extra `plan_item` argument to link calls to items.

A real conversation on 2026-09-30 (a report compiled to PDF, two specialists)
showed what this costs:

- Six of nine `update_plan` calls were refused. Five cited call ids the model
  made up (`read-bo19-2026`, `pdf-pages-3-4`); it never had usable ids. The
  sixth named an item before any plan existed.
- A refusal discarded the whole update, so valid progress sent with a bad
  citation was lost too. The model spent rounds of reasoning on what "this
  turn" meant.
- No item ever reached done. The plan read `0/4` for the whole task.
- The judge gave no verdict: no claim reached it.
- The planner returned no plan; the working model wrote all four items.

Two harnesses studied for comparison (read 2026-09-30) keep no per-item
verification. ZCode's TodoWrite and minimax-code's `todowrite` are lists the
working model rewrites; neither cites evidence. Both verify only a whole
session goal, once, at the end. minimax-code does it only on routes it pays
for, because on the user's own key it would "silently double their bill".

**Assumptions this decision depends on** (revisit it if any changes):

- A plan's job in Zhiyin is to show a person where the work stands. It is not
  a quality gate.
- The working model reports its progress honestly enough for that purpose.
  When it does not, the cost is a wrong tick in a progress list, not a wrong
  answer.
- A quality check, if one is added again, is judged by the product-evaluation
  protocol to catch misses often enough to pay for its requests.

## Decision

1. **The working model owns the plan.** No planner request writes one. The
   request that started each turn now only names a new conversation, and runs
   only for its first message.
2. **`update_plan` replaces the plan.** It takes the whole list, in order, each
   item a title and a status: pending, in progress, done or skipped. There are
   no ids, criteria, evidence or steps.
3. **An update is corrected, never refused for its content.** Entries without
   a title are dropped, text is shortened, and the list is cut to eight. Only
   the first item in progress stays in progress; later ones become pending.
   Only an update with no list at all is refused.
4. **One reminder.** When the model would finish a turn with items still
   pending or in progress, it is told which, once per turn, and the turn goes
   on. The plan is also shown at the start of each turn while it has open
   items.
5. **Nothing judges the plan.** The judge, its evidence handling, the
   `plan_item` argument, the verdict states and the judgement model dependency
   are removed.
6. **The pill shows four marks:** to do, in progress, done, skipped. It has no
   needs-a-look state, because nothing produces one.

## Consequences

- Each turn saves the planner request, and every tool schema loses an
  argument. Judge requests are gone.
- A model that marks work done without doing it is no longer caught by the
  plan. The final answer and the actions it took remain for the person to see.
- Plans saved in the old shape are not converted: the app is unreleased.
