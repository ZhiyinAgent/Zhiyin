# 0006. Authority comes from the implementation that owns a tool

Status: accepted

## Decision

- **Every action carries its owner.** When a conversation's tools are
  assembled, Zhiyin assigns each one an owner: built-in, skill, plugin or
  connector. A tool cannot choose its owner.
- **The owner's code declares the effect**: whether the action only reads, and
  whether it stays inside the workspace. The implementation that enforces
  containment computes it. A tool that declares nothing is treated as changing
  state and reaching anywhere.
- **Two kinds of tool action run without asking**: a built-in tool's read
  inside the workspace, and reading an enabled plugin's own content (loading
  its skill, listing what it holds). Everything else asks: file changes,
  deletion, shell commands, reads outside the workspace, and every connector
  and browser call.
- **Nothing the model or a server writes grants authority**: not a tool's
  name, a server's read-only annotation, a model-written explanation, a
  command's prefix, an answer to a question, standing instructions, a loaded
  skill, an enabled plugin, or an onboarding choice.
- **A person may allow a repeated action for one conversation**: edits by
  `write_file` or `multi_edit` inside one folder below the workspace root, or
  one connector tool on its current connection and schema. A grant never covers
  deletion, a shell command or a Python script, does not carry to another
  conversation, and can be revoked from the conversation's menu.
- **A connector tool is read-only only when its plugin says so.** A plugin may
  list the tools of its connector that only read. That list decides what a
  read-only specialist is offered (ADR 0015); the call still asks.
- **The permission engine answers allow or ask for every tool action, with a
  reason.** It is the one place this is decided. What touches only the
  conversation itself does not reach it: asking the person a question or
  giving a quiz, drawing a chart or diagram in the conversation, keeping the
  plan, activating an enabled plugin, and handing work to a specialist, whose
  own calls are decided like any other.

## Why

A person approving an action has to trust that the description is true of the
call. A tool's name, a server's annotation and a model's sentence are all
written by something other than the code that runs, and an MCP server can
choose any name, including a built-in's.

Asking for everything teaches people to approve without reading, which costs
the one prompt that matters. Workspace reads by Zhiyin's own tools, and reading
what the person installed and enabled, cannot do anything the person has not
already chosen.

## Rejected

- Asking for every call: safe, and it trains the person to click through.
- Trusting MCP tool annotations: the specification calls them hints, not to be
  trusted from an untrusted server.
- Allowing shell commands by prefix or classification: nothing in a command
  string bounds what it reaches (ADR 0007).
- Grants for every target of a connector tool named after the target: a
  browser grant would name one page and cover every page.
- Rules remembered across conversations or projects: they would reach work the
  person has not seen start, and would need their own evidence that they
  cannot be widened.

## Assumptions

- Built-in read tools enforce workspace containment and bound their output.
- MCP servers are untrusted.
- A person reads the action, its target and its consequence before allowing
  it.
