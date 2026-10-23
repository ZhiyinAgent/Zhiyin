import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * What an environment's Python runs as it starts, so its standard library
 * works in the container scripts and package installs run in (ADR 0026).
 */
const startup = String.raw`"""
Zhiyin runs this environment's scripts and package installs in a Windows app
container. These changes let Python's standard library work there.
"""

import os


def _reachable_folders():
    # A folder asked for as private, mode 0o700, as tempfile asks for its own,
    # is made by Python with permissions that let in the person and leave out
    # the container: the script could not use the folder it just made. It is
    # made as before Python 3.13 instead, taking the permissions of the folder
    # it is in.
    make = os.mkdir

    def reachable(path, mode=0o777, *, dir_fd=None):
        make(path, 0o777 if mode == 0o700 else mode, dir_fd=dir_fd)

    os.mkdir = reachable


def _pipes_in_the_container():
    # A container may make named pipes only below \\.\pipe\LOCAL\, so
    # multiprocessing names its own there.
    from multiprocessing import connection

    named = connection.arbitrary_address
    pipes = "\\\\.\\pipe\\"

    def local(family):
        address = named(family)
        if family == "AF_PIPE" and address.startswith(pipes):
            return pipes + "LOCAL\\" + address[len(pipes):]
        return address

    connection.arbitrary_address = local


def _real_paths_in_the_container():
    # Windows refuses a container a file's final path named by its drive, and
    # gives it named by its device, so os.path.realpath fails, and tarfile
    # with it, which pip unpacks source packages with. The device a drive
    # stands for is what the two names of a folder differ by, wherever no link
    # lies between them.
    import ntpath

    named = ntpath._getfinalpathname

    def device_path(path):
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateFileW.argtypes = [
            wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
            wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
        ]
        kernel32.CreateFileW.restype = wintypes.HANDLE
        kernel32.GetFinalPathNameByHandleW.argtypes = [
            wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD,
        ]
        kernel32.GetFinalPathNameByHandleW.restype = wintypes.DWORD
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        # Opened for no access, shared, following links, folders included.
        handle = kernel32.CreateFileW(path, 0, 7, None, 3, 0x02000000, None)
        if handle in (None, wintypes.HANDLE(-1).value):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            buffer = ctypes.create_unicode_buffer(32768)
            # Named by its device.
            if not kernel32.GetFinalPathNameByHandleW(handle, buffer, 32768, 2):
                raise ctypes.WinError(ctypes.get_last_error())
            return buffer.value
        finally:
            kernel32.CloseHandle(handle)

    def drive_path(path):
        drive, tail = ntpath.splitdrive(ntpath.abspath(os.fsdecode(path)))
        if not drive.endswith(":"):
            return None
        found = device_path(path)
        folder = drive + tail
        while True:
            try:
                by_device = found if folder == drive + tail else device_path(folder)
            except OSError:
                by_device = None
            inner = ntpath.splitdrive(folder)[1].rstrip("\\")
            if by_device and by_device.lower().endswith(inner.lower()):
                device = by_device[: len(by_device) - len(inner)]
                if found.lower().startswith(device.lower()):
                    return "\\\\?\\" + drive[-2:] + found[len(device):]
            parent = ntpath.dirname(folder)
            if parent == folder:
                return None
            folder = parent

    def final(path):
        try:
            return named(path)
        except PermissionError as refused:
            if getattr(refused, "winerror", None) != 5:
                raise
            # Anything that keeps the path from being mended, ctypes still
            # loading among it, as when loading it is what asked, leaves the
            # refusal as Windows gave it.
            try:
                mended = drive_path(path)
            except Exception:
                mended = None
            if mended is None:
                raise
            return mended

    ntpath._getfinalpathname = final


def _a_null_device_in_the_container():
    # A container may not open NUL, so subprocess.DEVNULL and os.devnull fail.
    # What would be written there goes down a pipe a thread reads and drops;
    # what would be read from there is a pipe already closed, which ends at
    # once. Nothing is kept.
    import io
    import builtins
    import subprocess

    names = ("nul", "\\\\.\\nul")

    def is_null(path):
        try:
            return os.fsdecode(path).lower() in names
        except TypeError:
            return False

    def drained():
        import threading

        read, write = os.pipe()

        def drain():
            try:
                while os.read(read, 65536):
                    pass
            finally:
                os.close(read)

        threading.Thread(target=drain, daemon=True).start()
        return write

    def ended():
        read, write = os.pipe()
        os.close(write)
        return read

    def null(flags):
        return ended() if flags & (os.O_WRONLY | os.O_RDWR) == 0 else drained()

    opened = os.open

    def open_null(path, flags, mode=0o777, *, dir_fd=None):
        if dir_fd is None and is_null(path):
            return null(flags)
        return opened(path, flags, mode, dir_fd=dir_fd)

    os.open = open_null

    opened_file = io.open

    def open_file(file, *args, **kwargs):
        if is_null(file) and len(args) < 7 and kwargs.get("opener") is None:
            kwargs["opener"] = lambda path, flags: null(flags)
        return opened_file(file, *args, **kwargs)

    io.open = builtins.open = open_file

    # A child's input from DEVNULL is the pipe that ends at once; its output
    # to DEVNULL goes to os.devnull above.
    handles = subprocess.Popen._get_handles

    def get_handles(self, stdin, stdout, stderr):
        empty = ended() if stdin == subprocess.DEVNULL else None
        try:
            return handles(
                self, stdin if empty is None else empty, stdout, stderr
            )
        finally:
            # The child is given a copy of it.
            if empty is not None:
                os.close(empty)

    subprocess.Popen._get_handles = get_handles


_reachable_folders()
_pipes_in_the_container()
_real_paths_in_the_container()
_a_null_device_in_the_container()
`;

/**
 * Loaded by a path file rather than as `sitecustomize`, because pip builds a
 * source package with a `sitecustomize` of its own, which would hide this one;
 * every path file in the environment's packages still runs.
 */
const files = {
  "zhiyin_container.py": startup,
  "zhiyin_container.pth": "import zhiyin_container\n",
};

/** Puts the startup files in an environment, unless they are there as they are. */
export async function keepStartup(environment: string): Promise<void> {
  const packages = join(environment, "Lib", "site-packages");
  await mkdir(packages, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const file = join(packages, name);
    if ((await readFile(file, "utf8").catch(() => "")) !== text)
      await writeFile(file, text, "utf8");
  }
}
