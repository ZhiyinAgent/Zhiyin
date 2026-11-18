# Adding a tool or a feature

Two short recipes. The [overview](overview.md) explains the layers they rely
on, and [testing-philosophy.md](../testing-philosophy.md) what their tests
must show. Run `powershell -File scripts/gate.ps1 -Quick` as you go and the
full gate before you commit.

## Adding a tool

1. **Choose its owner.** A tool belongs to the feature that owns what it
   acts on:
   - a file, folder, shell or display action every conversation needs is a
     workspace tool, in the `tools` feature;
   - an action on a program Zhiyin runs, such as Git, Python or a studio, is
     a tool of that feature's connection;
   - an action on an outside service is a tool of a remote connector, which a
     plugin declares; Zhiyin adds no code for it, only the plugin's
     manifest.

   Read the owner's feature page first: its public interface says how a tool
   is declared there.
2. **Describe it for the model.** A name, a JSON Schema for its parameters
   and a description: plain, concrete and calm, saying what it does and when
   to use it. A new tool's name and parameters are in `snake_case`, as tool
   names already are, and spelled as most APIs spell them (`color`); its
   text calls the one it works for "the person". In a plugin of more than ten tools, a tool may name a toolkit,
   a group of at most ten tools for one kind of work that the model opens
   when it needs it; a tool no toolkit names is offered as soon as its
   plugin is active.
3. **Inspect before running.** Inspection names the action, its target and
   the exact call, and declares its effects (ADR 0012): what it reads, what
   it changes and whether that change is backed up, what it can send, and
   whether it brings content from outside. The permission engine decides
   from those effects alone, so they must be true for that exact call. A
   connector that ships with Zhiyin declares each tool's effects in its
   plugin's manifest; a tool it does not name asks every time, as one of a
   connector a person added does.
4. **Return typed results.** A result carries a typed value, the files it
   created or replaced, and pictures apart from text. A refusal the model
   can fix with a better call is `correctable` and goes back to the model
   (ADR 0009).
5. **Test what a person relies on.** Behaviour tests in the owning feature,
   against a real temporary folder or process where a fake would hide the
   failure. If the tool brings a new kind of effect, add cases to the
   permission engine's corpus of actions and expected decisions. State the
   new invariant on the feature page.

## Adding a feature

1. **Write its page first.** Copy
   [the template](features/_template/README.md) to
   `docs/architecture/features/<name>/README.md`: its purpose in one
   paragraph, what it owns and does not, its public interface and its
   invariants. If the purpose joins two responsibilities with "and", it is
   two features ([working agreement](../working-agreement.md), §12).
2. **Make the package** `@zhiyin/<name>` in `packages/<layer>/<name>`, the
   folder of its layer, which is how lint knows the layer (ADR 0002). Give it
   a `src/index.ts` that only re-exports its public interface, and tests that
   run with nothing else present. Run `pnpm install` so the workspace links
   it.
3. **Keep to its layer.** A feature imports the contract, pure packages and
   platform packages, never another feature. If it needs another feature's work,
   define the interface it needs in its own terms, and let the composition
   root hand in the implementation.
4. **Wire it in the main process.** The composition root constructs it and
   hands it to whoever uses it: the core, the agent loop or a group, which
   import its types only.
5. **Cover each invariant with a test**, so breaking one fails the gate.
   `knip` fails the gate on an export nothing imports, so the public
   interface is what is actually used.
