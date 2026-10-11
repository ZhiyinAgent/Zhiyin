# 0028. Zhiyin's Blender writes only where it is let in

Status: accepted

## Decision

- **Zhiyin's Blender runs at low integrity.** It is started with the person's
  own token lowered to Windows' low integrity level, and everything it starts
  runs the same way. Windows refuses a low-integrity process every write to a
  file or folder that is not marked low, whichever way the write is asked for:
  Python, Blender's own code, a driver or a program Blender starts.
- **It reads what the person can read.** Lowering integrity leaves reading as
  it was, so a scene still uses a picture, a font or a model kept anywhere.
- **Two places are opened to it.** The conversation's own folder in Zhiyin's
  data is opened when Blender starts, and the workspace the first time a 3D
  call runs in it. Opening marks the folder low, with a mark Windows hands on
  to everything in the folder and to everything added later, so Blender
  writes anywhere in the workspace: new files, folders that were there before,
  and files it replaces.
- **A whole drive, or a folder that holds the person's user folder, is never
  opened.** Opening it would open all of it. 3D work in such a workspace is
  refused with the reason.
- **A folder Windows will not mark does not stop the work.** Some places keep
  no such marks and refuse no write for the lack of one. The reason is kept,
  and said if a write then fails.
- **What Blender keeps for itself goes to its own folder**: its settings,
  its temporary files and the render kernels OptiX builds.
- **A refused write is told as one.** A script that Windows refused a write
  outside the workspace is told that Blender may write only inside it.
- **A path without a drive still means the workspace** where a script's text
  shows it, as before. That reading is now a convenience; the boundary is
  Windows'.

## Why

Blender on Windows takes a path with no drive letter from the root of the
drive and makes the folders it names there. A script that saved three
pictures to `textures/…` put them in `C:\textures\` and nothing said so.
Reading a script's text before running it corrects the paths it can see, and
cannot see a path handed over by `setattr`, through another name, or built
while the script runs. Zhiyin says its work stays in the workspace, so the
limit has to be one no route goes round, and only the operating system
holds such a limit.

Integrity is the Windows mechanism whose rule is the one wanted: read as the
person does, write only where let in. It needs no change to Blender, and the
limit holds for a driver or a program Blender starts as it does for a script.

## Rejected

- Correcting more routes in the script's text, and listing the drive's root
  after each script: it closes the routes seen so far and reports some of the
  rest. It is not a limit.
- An app container or a restricted token: they limit reading too. Blender
  could not open the person's textures, fonts and models outside the
  workspace.
- Marking only the folders and files each call names: measured, a low process
  in a folder marked without handing the mark on adds, deletes and renames
  files but cannot change one in place or write in a folder that was already
  there. Half of what a script expects of a folder would work.
- Having Blender write in Zhiyin's data and copying the files into the
  workspace afterwards: a script that writes a file and reads it back by its
  workspace path would find nothing.
- An integrity level of Zhiyin's own, between low and medium, so that no other
  low process gains anything: Windows orders levels by number and would
  accept it, but documents only its own levels.

## Assumptions

- Windows refuses a low-integrity process a write to anything at the person's
  level, on a drive that keeps permissions. Measured on Windows 11 (22631) on
  2026-10-12.
- Marking the workspace low lets any low-integrity process running as the
  person write there, not Blender alone. Such processes are few: a browser's
  sandboxed processes also run with a restricted token, which the workspace's
  own permissions refuse. The mark lowers nothing for the person's ordinary
  programs, and it stays on the folder after Zhiyin is gone.
- Blender 5.2.2 renders at low integrity with Cycles on OptiX and CUDA and
  with EEVEE on NVIDIA graphics, as fast as before once OptiX has a cache
  folder it may write. Other makers' graphics are not measured.
- Windows marks about ten thousand files a second, once per workspace.
- A drive without permissions, and a network share, are not measured: the
  work goes on there and a refused write says why.
- A script cannot change Blender's own installation, which every conversation
  shares. Blender therefore keeps no compiled copy of its own Python and
  starts about a second slower on an installation that was never run at the
  person's level; measured, 1.5 s against 0.7 s.
