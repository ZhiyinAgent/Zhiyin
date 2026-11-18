# 0021. The space beside a conversation is three surfaces filled by adapters

Status: accepted

## Decision

### Three surfaces in one frame

- **The space beside a conversation has three surfaces: Document, 3D and
  Browser.** It shows one at a time. A new kind of thing to show is a new
  adapter in one of them, never a fourth surface.
- **Every surface is drawn in one frame.** The frame names what is shown and
  where it is, offers the surface's other items in a menu, holds the tools of
  what fills it and a way to close, and says alike that something is on its
  way or cannot be shown. What fills it is an adapter of its own, of one
  shape, which knows nothing of the others: the Document surface's PDF,
  picture and video, the 3D surface's Blender scene and CAD parts, the
  Browser's page.
- **The 3D view shows the conversation's Blender scene or the parts its CAD
  studio built last,** whichever the agent used last; the person picks the
  other from its menu. When one of the two goes, the 3D view shows the other.
- **Parts are drawn in the window with three.js.** Each successful build
  hands over a glTF binary of the parts it showed, each part named, which the
  CAD studio keeps for the conversation outside the workspace, the newest
  only. The window asks for it by conversation and build number and draws it
  turnable, each part in its own tone with its edges drawn, listed with its
  size. A failed build or a drawing hands over nothing, so the last good
  build stays.
- **A video Zhiyin's 3D studio rendered is played in the Document surface,**
  among the conversation's files, from a copy kept the moment it was written
  and bound to that file's size and time (ADR 0019). The window plays the copy
  from the `zhiyin-video:` scheme, which the main process answers from the
  kept copies alone, a range at a time so the person can move through a long
  video without it being read whole.
- **Part meshes and kept videos live in the app's data and go at the next
  start.** A deleted conversation's go with it.

### Whose choice the space shows

- **A person's choice of what the space shows holds while the agent works on
  what they chose.** Looking at the scene, the agent's changes to the scene
  show there; looking at the browser, its browser actions; looking at a
  document, the documents it writes or reads join the panel's list and never
  replace the one they look at.
- **Something new the agent makes elsewhere ends the choice and is shown,** by
  the rules the space follows without one: a new build of the parts while the
  person looks at the scene, a change to the scene while they look at the
  parts, a document while they look at the browser.
- **A space the person put away stays away until the turn ends,** whatever the
  agent makes, a later read included.

## Why

A person working with agents should not have to learn a new kind of panel
for every kind of output. Three surfaces match three things they recognise:
files the agent made, things in 3D, and the web. Adapters keep each kind of
output its own module, testable alone, and the frame keeps the surfaces alike.

Blender is not needed to look at a part. The CAD studio builds without it
(ADR 0023), and starting Blender for each build costs seconds and hundreds of
megabytes for a picture three.js draws in the window at once, from the format
the studio already exports.

A video is the one output that cannot be shown as pictures drawn elsewhere.
Decoding it in the window puts the media decoder in the window's process, so
what may be decoded there is narrowed to bytes Zhiyin's own encoder wrote,
copied before anything else could change them.

A turn can run for most of an hour: a mechanism designed in CAD, assembled in
Blender, animated, rendered and drawn. A choice that held until the turn ended
froze the space for all of it after one early look elsewhere, so the agent's
next build, its video and its drawing never came forward, and the person could
not tell the agent had moved on. A choice is still kept against what would
take it away from them: more work on the very thing they look at, or a new
document in place of the one they read.

## Rejected

- A surface of its own for parts, and one for videos: each new kind of output
  would add a choice to the switcher.
- Showing parts in the conversation's Blender scene: it couples the two
  studios, starts Blender for a part that has none, and a scene is the
  person's work that a build should not change.
- Sending a mesh or a video with the event that says it changed: either can
  be tens of megabytes, and an event reaches the window whether or not it
  shows that conversation.
- Playing any MP4 in the workspace: one the model wrote with other tools
  could be made to attack the decoder in the window's process.
- Sending a video to the window whole over IPC: a long render would sit in
  the window's memory, and moving through it would need all of it first.
- Holding a person's choice until the turn ends: the cause of the frozen
  space.
- Holding a choice for a time: a choice that lapses after so many seconds
  moves the view while the person is still reading it, at a moment they cannot
  foresee.
- Offering the new thing with a notice instead of showing it: it leaves the
  person to notice and click for every build in a long turn, which is the same
  freeze with a button.

## Assumptions

- three.js 0.186.1, released 2026-09-24 under the MIT licence, draws a glTF
  binary through `GLTFLoader.parseAsync` with no request, so the window's
  content security policy gains only `media-src zhiyin-video:` (checked
  2026-10-24).
- Chromium has not fallen back to software WebGL by default since version
  139, older than Electron 44's, so a machine without a usable GPU cannot
  draw parts. The 3D view says so and still lists them with their sizes.
- Electron 44.9.3 (Chromium 152) plays Blender 5.2.2's H.264 MP4 from a
  standard, secure, streaming scheme: it reads the metadata, asks for ranges,
  seeks and plays (checked 2026-10-24 by running it).
- A part mesh is small: a 120 mm plate with five holes, a slot and rounded
  corners, and a pin, comes to 77 KB.
- Something new on another surface is what a person wants to see over what
  they picked a while ago. A person who wants the space to stay as it is puts
  it away, and that holds.
- The agent is told what the person sees after each read, so it never says it
  showed something it did not.
