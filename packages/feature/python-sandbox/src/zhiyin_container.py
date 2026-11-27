"""
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


def _no_wmi_in_the_container():
    # Windows refuses a container WMI. platform asks it first for the
    # processor and the version of Windows, and is refused only after a tenth
    # of a second or more; it then answers from the environment's variables
    # and Windows' version, as it does where WMI is missing. Every script of
    # this environment runs in a container, so platform finds WMI missing and
    # answers that way at once.
    import sys

    sys.modules.setdefault("_wmi", None)


def _device_paths():
    # A file's final path named by its device, through ctypes' engine alone.
    # The ctypes package is not imported for it: from Python 3.13 it imports
    # sysconfig, which asks for a real path as it loads, and that request
    # would come back to the mending before ctypes could answer it.
    import _ctypes

    class handle(_ctypes._SimpleCData):
        _type_ = "P"

    class number(_ctypes._SimpleCData):
        _type_ = "L"

    class text(_ctypes._SimpleCData):
        _type_ = "Z"

    class letter(_ctypes._SimpleCData):
        _type_ = "u"

    class call(_ctypes.CFuncPtr):
        _flags_ = _ctypes.FUNCFLAG_STDCALL | _ctypes.FUNCFLAG_USE_LASTERROR

    class kernel32:
        _handle = _ctypes.LoadLibrary("kernel32")

    def function(name, restype, *argtypes):
        made = call((name, kernel32))
        made.restype = restype
        made.argtypes = argtypes
        return made

    create_file = function(
        "CreateFileW", handle, text, number, number, handle, number, number,
        handle,
    )
    final_path = function(
        "GetFinalPathNameByHandleW", number, handle, text, number, number
    )
    close = function("CloseHandle", number, handle)
    invalid = handle(-1).value

    def refused():
        code = _ctypes.get_last_error()
        return OSError(None, _ctypes.FormatError(code), None, code)

    def device_path(path):
        # Opened for no access, shared, following links, folders included.
        opened = create_file(path, 0, 7, None, 3, 0x02000000, None)
        if opened in (None, invalid):
            raise refused()
        try:
            buffer = (letter * 32768)()
            # Named by its device.
            if not final_path(opened, buffer, 32768, 2):
                raise refused()
            return buffer.value
        finally:
            close(opened)

    return device_path


def _real_paths_in_the_container():
    # Windows refuses a container a file's final path named by its drive, and
    # gives it named by its device, so os.path.realpath fails, and tarfile
    # with it, which pip unpacks source packages with. The device a drive
    # stands for is what the two names of a folder differ by, wherever no link
    # lies between them.
    import ntpath

    named = ntpath._getfinalpathname
    made = []

    def device_path(path):
        if not made:
            made.append(_device_paths())
        return made[0](path)

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

    def mend(path):
        # Anything that keeps the path from being mended gives no answer.
        try:
            return drive_path(path)
        except Exception:
            return None

    def drive_of(path):
        try:
            return ntpath.splitdrive(ntpath.abspath(os.fsdecode(path)))[0].lower()
        except Exception:
            return None

    # The drives whose paths Windows refused by name and gave by device. It
    # refuses every path on such a drive, about 5 ms a refusal, so their
    # paths are mended without asking it again. A path that cannot be mended
    # is still asked for, so what it answers, or why it refuses, is Windows'
    # own.
    refusing = set()

    def final(path):
        drive = drive_of(path)
        if drive in refusing:
            mended = mend(path)
            return named(path) if mended is None else mended
        try:
            return named(path)
        except PermissionError as refused:
            if getattr(refused, "winerror", None) != 5:
                raise
            mended = mend(path)
            if mended is None:
                raise
            refusing.add(drive)
            return mended

    ntpath._getfinalpathname = final


def _a_null_device_in_the_container():
    # A container may not open NUL, so subprocess.DEVNULL and os.devnull fail.
    # What would be written there goes down a pipe a thread reads and drops;
    # what would be read from there is a pipe already closed, which ends at
    # once. Nothing is kept.
    import builtins
    import io
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
_no_wmi_in_the_container()
_pipes_in_the_container()
_real_paths_in_the_container()
_a_null_device_in_the_container()
