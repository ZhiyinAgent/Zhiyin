# Decision records

Each record states one decision as it holds: what was decided, why, what was
rejected and what it assumes. A record that is overruled keeps its file and
gets `Status: superseded by NNNN`; a new record follows the
[template](0000-template.md).

## The app and its parts

- [0001](0001-an-electron-app-for-windows-with-a-typescript-core.md): an Electron app for Windows with a TypeScript core.
- [0002](0002-packages-sit-in-layers-held-by-lint-with-pure-packages-a-test-helper-layer-and-fakes-owned-by-the-package-that-owns-the-interface.md): packages sit in layers held by lint, with pure packages, test helpers and fakes owned by their interface's package.
- [0003](0003-the-window-is-a-sandboxed-view-of-core-state.md): the window is a sandboxed view of the core's state.

## Containment and the network

- [0004](0004-zhiyin-goes-online-through-chromiums-network.md): Zhiyin goes online through Chromium's network.
- [0005](0005-programs-zhiyin-starts-live-in-a-job-object.md): programs Zhiyin starts live in a Job Object.
- [0006](0006-a-confined-run-reaches-only-the-folders-and-hosts-it-is-given.md): a confined run reaches only the folders and hosts it is given.

## Conversations and turns

- [0007](0007-a-turn-owns-its-work-and-says-what-happened.md): a turn owns its work and says what happened.
- [0008](0008-each-conversation-works-in-its-own-folder.md): each conversation works in its own folder.
- [0009](0009-a-mistake-the-model-can-fix-is-answered-to-the-model-alone.md): a mistake the model can fix is answered to the model alone.
- [0010](0010-long-work-stops-where-the-person-says-and-the-model-keeps-its-plan.md): long work stops where the person says, and the model keeps its plan.
- [0011](0011-specialists-run-in-the-background-and-hand-back-one-report.md): specialists run in the background and hand back one report.

## Asking and undoing

- [0012](0012-the-person-is-asked-only-for-what-zhiyin-can-neither-prevent-nor-undo.md): the person is asked only for what Zhiyin can neither prevent nor undo.
- [0013](0013-file-changes-are-backed-up-and-going-back-restores-only-what-was-backed-up.md): file changes are backed up, and going back restores only what was backed up.
- [0030](0030-going-back-undoes-files-and-memory-as-the-person-chooses-each.md): going back undoes files and memory as the person chooses each.

## Models and requests

- [0014](0014-the-person-chooses-a-provider-and-a-model.md): the person chooses a provider and a model.
- [0015](0015-a-failed-model-request-is-retried-unseen-and-restarted-openly.md): a failed model request is retried unseen and restarted openly.
- [0016](0016-a-request-is-a-fixed-start-plus-notices-held-to-a-budget.md): a request is a fixed start plus notices, held to a budget.

## Capabilities

- [0017](0017-capabilities-are-plugins-found-in-one-catalog-connectors-are-reached-when-used.md): capabilities are plugins found in one catalog; connectors are reached when used.
- [0018](0018-the-agents-browser-is-zhiyins-own-and-its-preview-reaches-only-its-own-address.md): the agent's browser is Zhiyin's own, and its preview reaches only its own address.
- [0019](0019-documents-are-read-and-drawn-in-a-contained-process.md): documents are read and drawn in a contained process.
- [0020](0020-python-environments-are-named-and-packages-install-confined.md): Python environments are named and packages install confined.

## Studios

- [0021](0021-the-space-beside-a-conversation-is-three-surfaces-filled-by-adapters.md): the space beside a conversation is three surfaces filled by adapters.
- [0022](0022-3d-work-runs-in-zhiyins-own-blender-through-a-library-whose-calls-say-what-they-did.md): 3D work runs in Zhiyin's own Blender, through a library whose calls say what they did.
- [0023](0023-cad-parts-are-built-with-build123d-in-a-pinned-environment-and-drawn-from-the-exact-solids.md): CAD parts are built with build123d in a pinned environment and drawn from the exact solids.
- [0024](0024-studio-work-is-checked-against-version-exact-knowledge-and-reviewed-before-a-turn-ends.md): studio work is checked against version-exact knowledge and reviewed before a turn ends.

## Data and what Zhiyin fetches

- [0025](0025-data-stays-on-this-computer-history-says-its-format-export-removes-credentials.md): data stays on this computer; history says its format; export removes credentials.
- [0026](0026-zhiyin-remembers-in-files-the-model-writes-as-it-works.md): Zhiyin remembers in files the model writes as it works.
- [0027](0027-what-zhiyin-downloads-is-signed-or-pinned-model-list-programs-its-own-updates.md): what Zhiyin downloads is signed or pinned: the model list, programs, its own updates.

## The look

- [0028](0028-a-look-is-data-that-fills-fixed-slots.md): a look is data that fills fixed slots.
