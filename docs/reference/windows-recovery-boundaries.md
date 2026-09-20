# Windows recovery boundaries

Verified 2026-09-07 against Microsoft documentation, for the proposed
conversation rewind and file recovery work. These are OS capabilities and
limits, not capabilities already implemented by Zhiyin.

Windows Job Objects manage associated processes as a group and can terminate
them when the last owning handle closes. Child association has documented
exceptions, including children created through Win32_Process.Create and enabled
breakaway behavior. This supports structured process ownership; it does not
establish a filesystem or network sandbox, or reversal of completed effects.
Primary source: [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

Windows file opening exposes sharing controls for concurrent access. Exclusive
access can fail when another process already holds an incompatible handle.
This is relevant to guarded recovery: checking a digest and then replacing a
path does not by itself exclude an intervening external writer. The exact
handle, path-identity, and replacement strategy still requires implementation
and real Windows boundary tests; no native library is selected by this note.
Primary sources: [Creating and opening files](https://learn.microsoft.com/en-us/windows/win32/fileio/creating-and-opening-files)
and [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew).
