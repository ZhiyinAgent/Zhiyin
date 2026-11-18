# Context budget

## Purpose

How much a request to a model may carry: the size each context budget (Low,
Medium, Ultra) is held to on a given model, the share of it a typed message
and a source of standing instructions may take, and the one token estimate
all of them are measured by. The agent loop keeps each request within these
sizes and the window shows them while the person types, so both compute them
from here. It is a pure package (ADR 0002): it computes and does nothing else.

## Boundaries

- **Owns:** the budget formula, the shares of a budget the fixed start of a
  request, the latest request and one instruction source may take, the
  longest typed message and the longest instruction source a reader holds,
  and the token estimate.
- **Does not own:** the budget records, `ContextBudgetChoice`, `ModelWindow`,
  `ContextUsage` and `ContextBudgetOption`, which the contract declares;
  condensing a conversation to fit (the agent loop); where an instruction
  source is cut (text-and-names); a provider's own count of a request's
  tokens.
- **Talks to other packages only through:** the functions below. It imports
  only the contract's types.

## Public interface

- `contextBudgets(model)` and `contextTarget(choice, model)`, the request size
  each budget is held to on a given model.
- `typedMessageTokens(targetTokens)`, the most estimated tokens a message sent
  as typed text may take under a budget: the tenth of it that condensing keeps
  whole for the latest request. `longestTypedMessage` is the most characters
  such a message has under the largest budget, three to each of those tokens.
- `fixedPartFits(usage, targetTokens)`, whether the last request's fixed
  start, its instructions and tool definitions, keeps within the 15% of the
  target it may take.
- `instructionTokens(targetTokens)`, how much of one source of standing
  instructions the model is sent under a budget: 5% of it, and never less than
  8,000, counted in estimated tokens so a source in Chinese has the room the
  same meaning has in English. `longestInstructionBytes` is as much of a
  source as a reader holds, a little more than any budget sends.
- `estimatedTokens(text)`, the one token estimate every layer uses: UTF-8
  bytes divided by three, close for Chinese and cautious for English.
  `utf8Bytes(text)` counts those bytes without encoding the text, and
  `tokensForBytes(bytes)` and `bytesForTokens(tokens)` turn a size in bytes
  into tokens and back at the same three bytes a token.

## Invariants

- A budget's target is one formula. On a window `W` of 300k tokens or more,
  Low, Medium and Ultra are `min(128k, 0.5W)`, `min(262k, 0.75W)` and
  `min(1M, 0.85W)`. Below 300k there is no Ultra, and Low and Medium are
  `min(128k, 0.75W)` and `min(262k, 0.85W)`. No target exceeds the window less
  room for the reply, `min(longest reply, 16,000)`, and a 5% margin. Ultra on a
  model without it is Medium, and an unknown window is taken as 128k.
- One source of standing instructions is sent 5% of the budget, and never
  less than 8,000 estimated tokens.
- A text's size is counted in UTF-8 bytes as an encoder would count it, in any
  script, and its tokens as a third of that, rounded up; a size in tokens
  stands for three times as many bytes.
