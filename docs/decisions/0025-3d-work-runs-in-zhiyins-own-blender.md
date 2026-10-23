# 0025. 3D work runs in Zhiyin's own Blender, one headless session per conversation

Status: accepted

## Decision

- **Zhiyin runs its own Blender and never the person's.** It installs a
  pinned portable release of Blender when the person agrees, checked against
  the fingerprint Blender publishes (ADR 0020), and runs it headless. Driving a
  Blender window the person has open is not a goal.
- **One session per conversation, reached over pipes only Zhiyin holds.** A
  conversation's Blender starts the first time it is used, in its Job Object
  and its app container (ADR 0005, ADR 0006), and stays open while the
  conversation uses it. Commands and answers travel over two pipes created
  for that launch; the session listens on no port and loads no add-on.
- **Stopping a turn keeps the scene open** with its session, so the next turn
  carries on from it (ADR 0007). A 3D command that was running when the turn
  stopped still ends the session; the scene file and the preview stay.
  Deleting a conversation, and closing Zhiyin, end its session. A
  conversation left alone for fifteen minutes, neither on screen nor running a
  turn, has its session ended, and the next command starts it again.
  Anything that changes the conversation starts the count again.
- **The scene is a file in the workspace.** A session works on one `.blend`
  file the model opens or creates there, and saves it after every change. When
  the file changes on disk, through going back in the conversation or by the
  person's hand, the session reloads it before the next command, so the file
  is always the truth and rewind covers it like any other file.
- **Typed tools for the common steps, code for the rest.** Adding and editing
  objects, modelling operations such as cutting a hole, materials, the camera,
  lighting, rendering and exporting are tools with schemas, each described in
  a sentence a person can approve. Allowing a change to the open scene for the
  conversation allows every change to it that writes only new files (ADR
  0009). Any other Blender Python runs through one script tool whose approval
  shows the whole script, and which asks every time. What the installed
  Blender's API accepts is answered by the running Blender itself.
- **The person watches the scene change.** After every change the session
  renders a quick preview, kept in the app's data folder and never in the
  workspace, and the 3D view beside the conversation shows it. A new preview
  replaces the shown one only once it is complete. The view shows the scene's
  camera, or an overview framing every object that the person can turn by
  dragging; turning it never changes the scene.
- **Final renders and exports are workspace files.** They are written where
  the model asks inside the workspace, and a render opens in the document
  viewer like any picture.
- **A command that does not finish ends the session.** When a command runs
  past its time limit or the turn is stopped, the session is ended and the
  next command starts a new one from the saved file. The model is told the
  change was not made.

## Why

3D work is a way to make things a person can use: product pictures, a room
from its floor plan, a part to print. Blender does all of it, runs headless,
and is free software with a published fingerprint for every release, so it
fits the way Zhiyin installs Typst and uv.

A Blender that starts for every call costs about two seconds, and its first
EEVEE picture compiles shaders for about ten more. Held open, the same session
renders a 960×540 preview in a fifth of a second on a recent GPU, which is
what lets the person watch every change rather than wait for a final render.
For the same reason a stop leaves the session open: the scene the agent built
is not what the person stopped, and the next turn needs it. The cost: a
session left open holds its memory until the conversation is left alone long
enough, deleted, or Zhiyin closes.

A script is precise for a model but opaque to a person, and Blender's Python
API changes between releases: 4.0 renamed most inputs of its main material
node, and 4.1 removed auto smooth. Generated code written for an older release
fails, most of all from the inexpensive models Zhiyin is meant to work with. A
typed tool hides those changes and reads as a sentence; the script tool stays
for everything a fixed set of tools cannot cover.

## Rejected

- **The person's Blender, through Blender Lab's MCP server and add-on.** It
  drives a window the person has open, needs their installation and add-on,
  speaks over stdio, which Zhiyin's connections do not, and reaches Blender
  through a TCP socket any local program can connect to.
- **A new Blender process for every call.** Too slow to preview every change,
  and nothing would hold the scene between calls but the file.
- **A local socket to the session.** Any program on the machine could drive
  it.
- **Ending the session on every stop.** It throws away the session the next
  turn needs, and makes a stop costly.
- **Only a script tool.** Approvals become code, and API changes break
  generated scripts.
- **Only typed tools.** Blender's API is larger than any fixed set.
- **Drawing the scene in the window from an exported model.** It would parse a
  model-made file in the app's own processes (ADR 0023), and the preview would
  differ from what Blender renders.
- **Online design services.** Local work was preferred, with nothing sent
  anywhere to make a picture.

## Assumptions

- Blender's portable release for Windows runs from any folder without
  installing. Blender 5.2.2 is a 404 MB download and 914 MB unpacked (10
  October 2026).
- Blender's sources are GPL-2.0-or-later (checked on 5.2.2), and Blender asks
  that published scripts using its API be shared under a GPL-compatible
  licence. The session script Zhiyin runs inside Blender is Apache-2.0, which
  is compatible with GPLv3.
- Measured on an RTX 4070 Ti SUPER, 10 October 2026: a headless start in about
  2 s, the first EEVEE picture in about 10 s, then 0.14 to 0.19 s for each
  960×540 preview; Cycles with OptiX at 16 samples in 2.6 s.
- Blender is not marked as able to use long paths, so Windows' long-path
  setting does not help it. Its deepest file is 142 characters below its
  folder; installed where that passes 260 characters, it cannot load its own
  scripts and fonts. Started through a `\\?\` path it loads them, but Cycles
  then cannot find its GPU kernels (5.2.2, 10 October 2026), so Zhiyin starts
  it normally and refuses one installed too deep, saying why. In the default
  data folder that happens only for user folders over 27 characters long.
- On a PC whose graphics cannot run EEVEE, previews fall back to Cycles on the
  processor, more slowly.
- Code run inside Blender reaches only what its container is given: its
  installation, the session script, the workspace and its own parts of the
  conversation's folder, and no network (ADR 0006). The approval is the
  control within that.
- A session that sits idle uses memory and nothing else.
