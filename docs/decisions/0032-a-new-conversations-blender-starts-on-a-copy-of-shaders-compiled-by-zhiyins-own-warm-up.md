# 0032. A new conversation's Blender starts on a copy of shaders compiled by Zhiyin's own warm-up

Status: accepted

## Decision

- **One shader cache is kept for each Blender and graphics driver.** Zhiyin
  keeps, in its own data and outside every conversation's folder, the NVIDIA
  driver's GL shader cache for one Blender executable, known by the SHA-256
  of its contents, on one driver version. The version is the device property
  Windows states for each NVIDIA card connected (`DEVPKEY_Device_DriverVersion`,
  vendor ID 10DE), read through Windows' own `pnputil` in a Job Object (ADR
  0005) each time a new conversation's Blender first starts.
- **Only a Blender started for that alone makes it.** It runs in a folder and
  an app container new for it, reads only Blender's installation, the
  session script and that folder (ADR 0006), and starts as a session does,
  drawing the warm-up picture, but runs no command. Once its container's
  cache holds files and has stayed the same for a second, that Blender is
  ended, the cache is copied out and kept if it did not change while it was
  copied, and the folder and the container are removed. The folder's name is
  shorter than a conversation's, so the cache is made wherever a
  conversation's own would be. No conversation's Blender, a script's
  included, ever writes into what is kept.
- **It is made in the background, never ahead of a call.** When a
  conversation's Blender starts on the graphics card in a new container and
  no kept cache matches its Blender and driver, it starts as it would without
  one; once it has said it is ready, the cache is made. Each cache is tried
  once in a run of the app, one at a time. Keeping it removes every cache
  kept before, for another Blender or driver.
- **A conversation gets a copy, never the kept folder.** Before a new
  container's first Blender starts, the kept cache's plain files and folders
  are copied into the container's own folder, `AC\NVIDIA\GLCache`, through a
  folder of a new name renamed into place. Nothing is linked or shared, and a
  container that already has an NVIDIA folder of its own is left as it is.
  The conversation may change its copy; nobody else receives it.
- **Whatever fails, a start goes on as it does without a cache.** No NVIDIA
  card, a driver version that cannot be read, a Blender that draws on the
  processor, a start that only finds out how this PC draws, a copy that
  fails, and a make that does not draw each leave the start uncopied.

## Why

A Blender's first start in a new container compiles the shaders of its
warm-up picture. Measured on 2026-11-27 on an RTX 4070 Ti SUPER, driver
32.0.16.1088, Blender 5.2.2, from a new conversation's first call
(`blender_open_scene`) until its session was open: 18.3, 16.7 and 16.8 s
without a kept cache, as before this decision; 3.2, 3.2 and 3.4 s on the kept
cache. The call after it, an object added and previewed, took the same
either way: answered in 0.11 to 0.16 s, previewed in 0.23 to 0.43 s.

Each conversation's Blender has a container of its own so that nothing one
conversation's code leaves reaches another (ADR 0006, ADR 0008). A model's
script runs in a Blender in the conversation's container, which may write
the container's folder and so its shader cache. A cache shared between
conversations would cross that line both ways:

- **Learning.** A cache holds the programs compiled from the shaders a
  Blender drew with, which follow the materials, node setups and effects of
  the scenes it drew. Reading another conversation's cache could tell what
  kind of scenes that conversation drew.
- **Poisoning.** The driver loads what the cache holds into every Blender
  that starts on it. A cache a script wrote into could hand the next
  conversation's Blender an entry crafted for a flaw in the driver's loader,
  or one that is valid but draws wrongly.

The kept cache is made from nothing but Zhiyin's warm-up picture, the
Blender build and the driver, which every conversation's start compiles the
same way anyway. It holds nothing of any conversation, so there is nothing
to learn from it, and no conversation writes it, so there is nothing to
poison. Copying ends what a conversation does to its cache at its own
container: what it changes in its copy is gone with the conversation.

A driver update or a new Blender changes the cache's name, so no kept cache
matches: the next new conversation starts as without one, and a new cache
is made and replaces the old.

The cost: a new conversation's first start copies the kept cache, about
19 MB, and runs `pnputil`, about 0.1 s; the first start of each run hashes
Blender's executable, about 110 MB. Once per Blender and driver, a Blender
of Zhiyin's own compiles the warm-up again in the background, for 17 s after
the first conversation's session opened, while that conversation's work
shares the processor and graphics card with it. Measured on 2026-11-27, a
call made beside it cost little: an object added right after the session
opened was answered in 0.12 s and previewed in 0.24 s, and one added 6 s
later, while the make was compiling, in 0.05 s and 0.31 s, against 0.02 s
and 0.39 s with no make running. The cache covers the warm-up's shaders
only; a scene's own materials are compiled in each conversation as before.

The driver writes its cache on its own schedule and holds the files open
while Blender runs. Observed on 2026-11-27: a Blender that ended as soon as
it had drawn the warm-up, as the start that finds out how a PC draws does,
left the cache's folder without a file, and copying while Blender ran failed
on the open files. A session's start had written them, about 19 MB, by the
time it said it was ready, and they stayed the same after; that is why the
make starts as a session does, waits for the cache to stay the same, and
copies it only once Blender has ended. Blender is not marked as able to use
long paths, so its driver cannot write a cache file whose path passes 260
characters; in the tests a conversation's comes to 255. The make's folder is
kept no deeper than a conversation's, so the make never fails where a
conversation's own cache would be written.

## Rejected

- Keeping the cache a conversation's session leaves, as the real-Blender
  tests do for their own speed: any conversation's script would write what
  later conversations load.
- One live folder that every container reads, by a link or a grant: every
  conversation would write what the others read.
- Reading the driver version from the device's software key under
  `HKLM\SYSTEM\CurrentControlSet\Control\Class`: Microsoft says a device's
  software key must not be opened directly, as its place and format may
  change between versions of Windows.
- WMI (`Win32_VideoController`): it reaches the same value through a
  service and a provider of its own, and needs PowerShell or COM to ask;
  the tests use it only to check the version read.
- Electron's GPU information: only the Electron main process has it, and
  the feature and its tests run without Electron.
- Making the cache only at Blender's installation: the driver can change
  afterwards, so the background make is needed anyway.

## Assumptions

- NVIDIA's driver keeps an OpenGL program's shader cache in
  `NVIDIA\GLCache` under the local application data Windows gives the
  process, which for a process in an app container is the container's
  folder, `Packages\<container>\AC`. Neither the place nor how the driver
  keys its entries is documented; both were observed with driver
  32.0.16.1088 on 2026-11-26 and 2026-11-27.
- The driver reads a cache made by another container for the same Blender
  and driver, and treats a cache it cannot use as missing, compiling again.
  Both were observed on this PC on 2026-11-27: a kept cache whose files were
  overwritten with random bytes of the same sizes left a start that compiled
  again and opened, in about the time of one without a cache. A cache from
  another card on the same driver was not tested, nor were entries crafted
  to be misread rather than refused.
- A cache that has stayed the same for a second while Blender runs is
  complete: the driver adds nothing to it as Blender ends. Observed on one
  driver; a driver that writes later than that would leave a kept cache
  that holds less, which only makes a start compile more.
- AMD's and Intel's drivers keep their caches elsewhere or not at all; they
  are not covered. A PC with an NVIDIA card whose Blender draws on another
  is given a copy it does not use.
- `pnputil /enum-devices /properties` names each property by its `DEVPKEY`
  in every language Windows speaks; its `/properties` flag exists from
  Windows 11 21H2 (Microsoft's PnPUtil command syntax, read 2026-11-26).
  On an older Windows no version is read and nothing is copied.
- Every session's warm-up picture is the same, whatever the conversation,
  so what Zhiyin's own warm-up compiles is what a session's would.
