# 0009. Authority comes from the code that owns a tool

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
  `write_file` or `multi_edit` inside one folder below the workspace root; one
  connector tool on its current connection and schema; a set of calls a
  built-in connection names (below); Python scripts without the internet; and
  listing Python environments. A grant does not carry to another
  conversation, and can be revoked from the conversation's menu.
- **The code that owns a tool says which calls ask every time.** The tool's
  own inspection marks such a call: a deletion, a shell command, a Blender
  script, a Python script that can use the internet, every change to a Python
  environment, and staging, committing or stashing with git, which run the
  repository's own hooks and filters with the account's full access. No grant
  is offered for a marked call, and no saved grant applies to it, whatever the
  tool is called. The agent loop keeps no list of other features' tool names.
  The mark only takes authority away, and a remote connection cannot set it:
  its inspection is written by Zhiyin, not by the server.
- **A built-in connection may offer one allowance for a set of its calls.** Its
  inspection carries an allowance: a key every call in the set carries, and a
  label naming the set in words. Only a connection Zhiyin ships can say this;
  a remote connection's inspection never reaches the field. Allowing such a
  call for the conversation allows the set: any later call of the same
  connection carrying the same key runs without asking, until the person
  revokes it or the conversation ends. A call with another key, or none, asks.
- **The 3D studio offers one set: changes to the open scene.** Every 3D call
  on the scene that writes only new files shares a key made of the workspace
  and the scene. Opening another scene, replacing an existing file and running
  a script carry no key: the first two ask again, and a script is asked for
  every time.
- **An allowance is saved as a connector rule for every tool of the
  connection.** Its tool name is the connection's prefix followed by `__*`, a
  name no tool has, and its identity is the key. Saved history keeps its
  format.
- **Which tools only read is said by the code that runs them, or by the
  plugin that declares a remote server.** A connection Zhiyin ships lists each
  of its tools with `access: "read"` when the tool only reads, as git does for
  status, diffs, log, show and branches. A plugin may list the tools of its
  remote server that only read, in `readOnlyTools`; each built-in plugin lists
  them by name, checked against the server's own listing, so alphaXiv's eight
  read tools for public papers and researchers are listed and its tools on the
  person's library are not. The same field from a server Zhiyin does not ship
  counts for nothing, nor does a server's own read-only annotation. A tool
  marked as reading decides what a read-only specialist is offered (ADR 0019);
  the call still asks.
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
choose any name, including a built-in's. The feature that owns a tool knows
what its calls can reach, and which of them only read: git's code starts no
program the repository brings for status or a diff, and does for a commit. A
list of tool names kept in the agent loop goes stale whenever a feature adds or
renames a tool, and a tool missing from it becomes grantable: one grant for a
git commit would let every later commit run the repository's hooks unasked,
including a hook a confined Python script could have written into the folder.

Asking for everything teaches people to approve without reading, which costs
the one prompt that matters. Workspace reads by Zhiyin's own tools, and reading
what the person installed and enabled, cannot do anything the person has not
already chosen. Making one object in the 3D studio takes many calls: parts,
materials, lighting, the camera, previews and a render. No two are the same,
so allowing each exact call covers nothing, and a person would approve more
than twenty prompts that all say "change this scene". The cost of the
allowance is that one approval covers calls the person has not seen, limited
to the scene they approved and to files that do not exist yet.

## Rejected

- Asking for every call: safe, and it trains the person to click through.
- One approval per exact 3D call: safe, and unusable for real 3D work.
- Allowing the whole 3D studio for the conversation: it would also cover
  replacing existing files and working on other scenes, which the person never
  saw asked.
- A new kind of saved rule for allowances: clearer, but a saved-history format
  step (ADR 0028) for one field.
- Trusting MCP tool annotations, or the read-only field from any server: the
  specification calls annotations hints, not to be trusted from an untrusted
  server, and a remote server could then choose what a read-only specialist is
  offered.
- A list of git's read tool names in a plugin: it would repeat what the
  connector's code says, and drift from it.
- A list in the agent loop of the tool names a grant never covers: the loop
  would have to be edited for every tool a feature adds or renames.
- Making a built-in connection's calls ungrantable unless its owner opts in:
  safer for a tool added later, but the 3D studio's script call carries its
  own identity and still needs the mark, so the mark is needed either way.
- Allowing shell commands by prefix or classification: nothing in a command
  string bounds what it reaches (ADR 0011).
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
- Each feature knows which of its calls can reach past what an approval
  describes, and what the code of a connection Zhiyin ships says of its own
  tools is as reliable as the code that runs them.
- Only built-in connections write an inspection's presentation fields, so a
  remote connection cannot claim an allowance.
- A saved rule whose tool name ends in `__*` matches no tool in a version that
  does not know allowances, so an older Zhiyin asks instead of allowing.
- Each 3D call declares the scene file and the files it writes, so they are
  backed up as any built-in change is (ADR 0012) and going back can restore
  them. A scene past the backup limits is changed unprotected without asking,
  as an edit is under a folder grant.
- A server's listing, checked when its plugin's list is written, keeps the
  same names; a renamed tool is offered to no read-only specialist until the
  list is updated.
