# Permission engine

## Purpose

Every action the agent wants to take passes through this engine before it
runs. The engine answers one question: may this run without the person
deciding? It returns a decision with a reason. No other part of the app makes
that call (ADR 0012).

## Boundaries

- **Owns:** the decision logic, the policy it applies, the reason attached
  to every decision, and the standing grant rules: what a question can offer
  for the conversation, and which grant held covers a call.
- **Does not own:** running a tool (tools and connectors), the approval wording
  a person reads (agent loop and renderer), recording decisions (the action
  record on the conversation), asking the person and keeping the grants they
  give (agent loop), reading what a file holds (whoever asks), or whether an
  MCP server may connect at all (MCP).
- **Talks to other features only through:** `decide(action)` and the grant
  rules. Callers get a decision and a reason, or a grant to offer and one
  that applies, never the rule that produced it.

## Public interface

- `decide(action) → Promise<Decision>`. The action carries:
  - its owner, assigned by the app: `built-in`, `mcp`, `skill` or `plugin`;
  - the validated tool name and arguments;
  - the action, target and command shown to the person;
  - `effects`, what the call does, declared whole by the code that carries
    it out (ADR 0012), where it reaches included. It may be missing;
  - `builtInConnection`, set by the connection feature, never by a
    connection, when the call goes to a connection Zhiyin ships;
  - `effectsDeclaredByZhiyin`, set by the connection feature when the
    call's effects come from a built-in plugin's manifest;
  - `conversation`, what the conversation holds, worked out by the agent
    loop: whether outside content is present, and whether something
    private is within reach;
  - `destinationSeen`, set by the agent loop when the address a call goes to
    came into the conversation from somewhere other than the model.
  - `personSays`, what the person said in Settings of a tool of a connection
    Zhiyin does not ship: that it only reads, or that it asks every time;
  - `asksEachTime`, said by the code that owns the tool: the call is asked
    about every time, and no grant covers it.
- `Decision = { outcome: 'allow' | 'ask' | 'deny', reason: string, covers?, why?, parts? }`.
  `covers` says, for a question, which grant for the conversation may answer
  in the person's place: `never`, `destination`, `file-or-folder`,
  `uncopied-file` or `tool`. `why` names the part of the policy that raised
  the question, and `parts` each of them when several did.
- `GuardedPermissionEngine` is the policy the app runs. It never answers
  `deny`; the outcome exists so the agent loop can be given a policy that
  refuses, and it handles one.
- `StandingGrantRules(places?)` implements `GrantRules`, the conversation's
  standing grants:
  - `grants({ owner, name, inspection, decision, granted, digest, standing })`
    answers, for a call `decide` asked about, the grant that can be offered
    for the conversation (`candidate` for the tool or its destination,
    `files` for a change's file or folder) and the grant held that already
    covers it (`applied`), by what the decision says may cover it. It reads
    the call's effects, as `decide` does, and the paths, connection and set
    of calls a grant is bound to. `digest` reads what a file holds now, and
    `standing` how a file Zhiyin could not copy stands; the engine reads no
    file itself.
  - `fileGrantsChangedBy(granted, owner, inspection)` names the file grants
    a write outside the workspace changed the file of.
  - `places` gives the person's user folder and the Startup folders, which
    `knownPlaces()` reads from this computer by default.
- The types these take and return: `Action`, `PermissionEngine`,
  `ConversationFacts`, `Covers`, `GrantQuestion`, `GrantAnswer`,
  `PermissionScope`, `FileOffer`, `KnownPlaces`, `ContentDigest`.

## The policy

One policy decides every action: what it does, by the effects the code that
carries it out declared (ADR 0012), with what the conversation holds.

Effects are trusted from a built-in tool and from a connection Zhiyin ships,
including the remote services a built-in plugin's manifest describes. A
connection Zhiyin does not ship asks whatever it declares or leaves out,
covered tool by tool, unless the person said in Settings that the tool only
reads (it runs) or asks every time (no grant covers it). A plugin or skill
runs only a read of what it holds; anything more asks every time. Any other
action that declares no effects asks every time, with no grant to cover it,
as the worst it could do. The strictest part of what an action does decides
it:

- It asks every time, with no grant to cover it, when it leaves something
  that runs later, runs code with the person's full access, changes the
  workspace in a way Zhiyin cannot put back (but for files it names that
  were too large to copy, below), acts as the person for good, or
  sends what the model wrote to a destination it chose while outside content
  and something private are both in the conversation. A send whose effects
  say it carries nothing the model wrote, or the address alone when that
  address is already known, is not such a send. An account action that does
  not name where it lands asks every time too.
- It asks, and a grant may cover it, when it acts as the person through a
  connection in a way that can be taken back (by its destination), changes
  files outside the selected folder (by file or folder), or changes files
  Zhiyin could not copy and names them, when that is all it cannot put back
  (by each file, ADR 0013). A file grant is bound to the paths a call
  declares, so only a built-in tool or a connection Zhiyin ships can have
  one; a call whose effects alone a built-in plugin's manifest declares is
  asked about every time instead. Reading outside the selected folder asks
  every time, and so does acting as the person other than through a
  connection: no grant covers either. An action that needs two of these asks
  every time, and names each.
- Everything else runs: reading the workspace or Zhiyin's own records,
  changing them in a way Zhiyin can put back, sealed-off code, the model's
  own included, whether or not the person ran it before, sending to a
  service the person connected, bringing outside content in, and going to an
  address the conversation already holds. A CAD, Blender or Python script
  that runs sealed off and changes only the workspace falls here.

Without what the conversation holds, the worst is assumed.

A call the code that owns its tool marks to be asked every time is asked
about whatever its effects say, and no grant covers it (ADR 0012); the
question keeps the part of the policy that would have raised it, if any.

When the engine asks, the agent loop may answer with a permission the person
granted earlier in the conversation; otherwise it waits for the person. The
policy never returns `deny`. A `deny` from a policy would refuse the action
even where a conversation permission covers it.

## Invariants

- Authority comes from a declaration made by code the app owns, never from a
  tool's name. Whoever writes a tool chooses its name, so a connected tool
  that calls itself `load_skill` or `read_file` gains nothing. An MCP server's
  own read-only annotation counts for nothing here for the same reason; that
  a connection is one Zhiyin ships is said by the connection feature, from
  its own list, never by the connection.
- Silence is not a claim. An action that does not say what it does asks
  every time, whoever owns it, so a new tool cannot become automatic by
  leaving something out.
- Containment is decided once, by the implementation that enforces it, and
  passed in as the action's effects. The engine never works it out again
  from the displayed target: a second check would be a second boundary to
  keep in step.
- The effects are the one description of what a call does. The engine and
  the standing grant rules both read them, so they agree: for every
  combination of effects, the engine says a kind of grant may cover a call
  exactly when the grant rules offer a grant of that kind, given the paths
  and connection a grant is bound to.
- A shell command always asks: the shell tool declares every command code
  with the person's full access. Nothing in a command string bounds what it
  reaches, so no text earns it automatic approval (ADR 0012). Looking around
  the workspace goes through the typed read tools instead.
- Every decision carries a plain reason for audit and failure handling, never
  a rule object or internal code. The wording a person sees on an approval is
  written elsewhere (ADR 0014).

### Standing grants

- The person may allow one connector tool for the rest of a conversation; the
  grant can be revoked. When the connector's identity holds the call's own
  inputs, the grant is said to cover only that exact call. When a built-in
  connection names a set of its calls the call belongs to, the grant covers
  that set: every call of the same connection that names it (ADR 0012). A
  grant across a connection's tools, for such a set or for where a call
  lands, is bound to the connection's id the connection feature set on the
  call, never read from a tool's name; a call that names no connection is
  offered none. A
  call whose own code says it is asked every time is asked about and never
  covered, whatever it is called and whatever its effects: deletions for good
  and outside the workspace, moves across the workspace's edge, shell
  commands, changes to a Python environment and a script whose environment
  is made first, and git's staging, committing, stashing and branch creating
  and switching (ADR 0012). No tool's name decides it.
- A change in the workspace by a built-in tool that says a file grant covers
  it can be allowed for the rest of the conversation in one click, by its file or by the folder holding
  every file it changes, the workspace itself included (ADR 0012). A file's
  grant covers writes, edits and moving it to the Recycle Bin while it is as
  Zhiyin last wrote it; a change made to it elsewhere since asks again. A
  folder's grant covers creating, writing and editing the files in it and the
  folders in it, and moving them to the Recycle Bin, never deleting the folder
  itself. A deletion's card offers only its folder. No grant covers or offers
  a file in a `.git` folder, at any depth or case. No folder grant is offered
  for a workspace that is a drive, the person's user folder, or a folder
  holding it. Each file grant a call changes the file of is kept as the call
  left it, whichever grant let the call run, and a file given again keeps one
  grant. A change is covered by the
  path the tool declared, never resolved again, and a declared path that is
  full, steps up a folder or has a colon is never covered (ADR 0013). A grant
  holds for the conversation's own folder, and not the same name in a folder
  the conversation moves to.
- A write outside the workspace, by a built-in tool that says a file grant
  covers it or by a connection Zhiyin ships, can be allowed for the rest of the conversation in one click,
  by its file or by its folder, each by its real path (ADR 0012). Only those
  grants cover it: never a connection's allowance or a grant for the exact
  call. A connection's call that also changes workspace files, as a render
  keeps its settings in the scene, is covered with them by the grant for its
  outside file or folder, and those files are backed up as any change inside
  the workspace is. A file's grant holds while the file is as Zhiyin last
  wrote it; a change made to it elsewhere since asks again. A folder's grant
  covers that folder and the folders in it. No folder grant is offered for a
  drive, the person's user folder, or a folder holding it. A folder's grant
  holds a path by the folder's exact name, as both come from the real
  folder: a sibling whose name starts the same, or differs only in case, is
  outside it. No grant offers or covers a file that runs later without
  anyone starting it: one in a `.git` folder, or in a Startup folder Windows
  runs at sign-in, any account's; each such write asks. A write outside the workspace is backed up first, as a change inside
  the workspace is.
- A script a connection Zhiyin ships runs, given folders outside the
  workspace that Zhiyin copies first, is offered for the conversation the
  folder it names, or the folder holding all it names, on the same terms as
  a write there: none that would cover nearly everything, and none in a
  `.git` or Startup folder. It is covered when every folder it names is in
  a folder granted for changes outside the workspace, whichever tool's call
  the grant was made from, and a grant made for it covers a file tool's
  write there. One whose folders could not be copied is offered nothing.
- A change to files Zhiyin could not copy, by a built-in tool or a
  connection Zhiyin ships, is offered its one file for the conversation,
  as changes to it without a backup. It is covered when every such file it
  changes has a grant, whichever tool's call the grant was made from, and
  each holds while the file's size and time of change are as the
  conversation last left them; changed elsewhere since, it asks again. Two
  such files with no grant offer nothing, and a file that runs later is
  never offered or covered.

## Testing notes

The engine's correctness rests on its tests: a rule that wrongly approves a
destructive action type-checks perfectly, and its package boundary is held by
lint, not the compiler (ADR 0002). The tests are an adversarial corpus of
concrete action shapes, each mapped to the expected decision and reason. A
bypass found during development is added to it permanently. Tests check the
returned `Decision`, never which rule fired.

That callers cannot get around the engine is a separate claim, tested in the
agent loop against a real filesystem effect.

For the tests of the packages above it, `@zhiyin/permission-engine/testing`
offers `fakePermissions()`, an engine that refuses every action (ADR 0002).
