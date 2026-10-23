/**
 * Asks Windows, without deleting anything, whether it would move each path to
 * the Recycle Bin.
 *
 * Windows says, to a file operation's progress sink before each item is
 * deleted, whether the drive and the person's settings let it recycle. This
 * runs that operation and aborts it at that moment, the same check Electron's
 * own move to the Recycle Bin relies on, so nothing is touched.
 *
 * That answer does not cover size. An item larger than the Recycle Bin holds
 * is found too large only later, and then deleted permanently without a word,
 * even by Electron's move to the Recycle Bin. So the size is compared here
 * with the capacity Windows keeps for the drive, and an item whose size or
 * capacity cannot be read is not answered for.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { runProcess, type RunProcess } from "@zhiyin/process-ownership";

const script = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItem {}

[ComImport, Guid("04b0f1a7-9490-44bc-96e1-4296a31252e2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IFileOperationProgressSink {
  [PreserveSig] int StartOperations();
  [PreserveSig] int FinishOperations(int hr);
  [PreserveSig] int PreRenameItem(uint f, IShellItem i, [MarshalAs(UnmanagedType.LPWStr)] string n);
  [PreserveSig] int PostRenameItem(uint f, IShellItem i, [MarshalAs(UnmanagedType.LPWStr)] string n, int hr, IShellItem c);
  [PreserveSig] int PreMoveItem(uint f, IShellItem i, IShellItem d, [MarshalAs(UnmanagedType.LPWStr)] string n);
  [PreserveSig] int PostMoveItem(uint f, IShellItem i, IShellItem d, [MarshalAs(UnmanagedType.LPWStr)] string n, int hr, IShellItem c);
  [PreserveSig] int PreCopyItem(uint f, IShellItem i, IShellItem d, [MarshalAs(UnmanagedType.LPWStr)] string n);
  [PreserveSig] int PostCopyItem(uint f, IShellItem i, IShellItem d, [MarshalAs(UnmanagedType.LPWStr)] string n, int hr, IShellItem c);
  [PreserveSig] int PreDeleteItem(uint f, IShellItem i);
  [PreserveSig] int PostDeleteItem(uint f, IShellItem i, int hr, IShellItem c);
  [PreserveSig] int PreNewItem(uint f, IShellItem d, [MarshalAs(UnmanagedType.LPWStr)] string n);
  [PreserveSig] int PostNewItem(uint f, IShellItem d, [MarshalAs(UnmanagedType.LPWStr)] string n, [MarshalAs(UnmanagedType.LPWStr)] string t, uint a, int hr, IShellItem c);
  [PreserveSig] int UpdateProgress(uint total, uint sofar);
  [PreserveSig] int ResetTimer();
  [PreserveSig] int PauseTimer();
  [PreserveSig] int ResumeTimer();
}

[ComImport, Guid("947aab5f-0a5c-4c13-b4d6-4bf7836fc9f8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IFileOperation {
  [PreserveSig] int Advise(IFileOperationProgressSink s, out uint c);
  [PreserveSig] int Unadvise(uint c);
  [PreserveSig] int SetOperationFlags(uint f);
  [PreserveSig] int SetProgressMessage([MarshalAs(UnmanagedType.LPWStr)] string m);
  [PreserveSig] int SetProgressDialog(IntPtr p);
  [PreserveSig] int SetProperties(IntPtr p);
  [PreserveSig] int SetOwnerWindow(IntPtr h);
  [PreserveSig] int ApplyPropertiesToItem(IShellItem i);
  [PreserveSig] int ApplyPropertiesToItems(IntPtr i);
  [PreserveSig] int RenameItem(IShellItem i, [MarshalAs(UnmanagedType.LPWStr)] string n, IFileOperationProgressSink s);
  [PreserveSig] int RenameItems(IntPtr i, [MarshalAs(UnmanagedType.LPWStr)] string n);
  [PreserveSig] int MoveItem(IShellItem i, IShellItem d, [MarshalAs(UnmanagedType.LPWStr)] string n, IFileOperationProgressSink s);
  [PreserveSig] int MoveItems(IntPtr i, IShellItem d);
  [PreserveSig] int CopyItem(IShellItem i, IShellItem d, [MarshalAs(UnmanagedType.LPWStr)] string n, IFileOperationProgressSink s);
  [PreserveSig] int CopyItems(IntPtr i, IShellItem d);
  [PreserveSig] int DeleteItem(IShellItem i, IFileOperationProgressSink s);
  [PreserveSig] int DeleteItems(IntPtr i);
  [PreserveSig] int NewItem(IShellItem d, uint a, [MarshalAs(UnmanagedType.LPWStr)] string n, [MarshalAs(UnmanagedType.LPWStr)] string t, IFileOperationProgressSink s);
  [PreserveSig] int PerformOperations();
  [PreserveSig] int GetAnyOperationsAborted(out bool a);
}

[ComVisible(true)]
public class RecycleProbe : IFileOperationProgressSink {
  public bool Seen; public bool Recyclable;
  public int StartOperations() { return 0; }
  public int FinishOperations(int hr) { return 0; }
  public int PreRenameItem(uint f, IShellItem i, string n) { return 0; }
  public int PostRenameItem(uint f, IShellItem i, string n, int hr, IShellItem c) { return 0; }
  public int PreMoveItem(uint f, IShellItem i, IShellItem d, string n) { return 0; }
  public int PostMoveItem(uint f, IShellItem i, IShellItem d, string n, int hr, IShellItem c) { return 0; }
  public int PreCopyItem(uint f, IShellItem i, IShellItem d, string n) { return 0; }
  public int PostCopyItem(uint f, IShellItem i, IShellItem d, string n, int hr, IShellItem c) { return 0; }
  public int PreDeleteItem(uint f, IShellItem i) {
    Seen = true; Recyclable = (f & 0x80) != 0;
    return unchecked((int)0x80004004); // E_ABORT: nothing is deleted
  }
  public int PostDeleteItem(uint f, IShellItem i, int hr, IShellItem c) { return 0; }
  public int PreNewItem(uint f, IShellItem d, string n) { return 0; }
  public int PostNewItem(uint f, IShellItem d, string n, string t, uint a, int hr, IShellItem c) { return 0; }
  public int UpdateProgress(uint total, uint sofar) { return 0; }
  public int ResetTimer() { return 0; }
  public int PauseTimer() { return 0; }
  public int ResumeTimer() { return 0; }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr bc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem item);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool GetVolumePathName(string file, System.Text.StringBuilder root, int length);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool GetVolumeNameForVolumeMountPoint(string mount, System.Text.StringBuilder name, int length);

  // The most the Recycle Bin on this path's drive holds, in bytes; -1 when Windows keeps no figure.
  static long Capacity(string path) {
    var root = new System.Text.StringBuilder(1024);
    if (!GetVolumePathName(path, root, root.Capacity)) return -1;
    var name = new System.Text.StringBuilder(1024);
    if (!GetVolumeNameForVolumeMountPoint(root.ToString(), name, name.Capacity)) return -1;
    // The volume's name carries its id in braces, and that id names its key.
    var volume = name.ToString();
    var open = volume.IndexOf('{');
    var close = volume.IndexOf('}');
    if (open < 0 || close < open) return -1;
    // Joined rather than written with separators, which this text would have to escape.
    var keyName = System.IO.Path.Combine("Software", "Microsoft", "Windows", "CurrentVersion", "Explorer", "BitBucket", "Volume", volume.Substring(open, close - open + 1));
    using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(keyName)) {
      var value = key == null ? null : key.GetValue("MaxCapacity");
      return value is int ? (long)(int)value * 1024 * 1024 : -1;
    }
  }

  // What the item holds in all, as Windows measures it for the Recycle Bin.
  static long Size(string path) {
    if (System.IO.File.Exists(path)) return new System.IO.FileInfo(path).Length;
    long total = 0;
    foreach (var file in new System.IO.DirectoryInfo(path).EnumerateFiles("*", System.IO.SearchOption.AllDirectories))
      total += file.Length;
    return total;
  }

  public static string Check(string path) {
    IShellItem item;
    SHCreateItemFromParsingName(path, IntPtr.Zero, typeof(IShellItem).GUID, out item);
    var op = (IFileOperation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("3ad05575-8857-4850-9277-11b85bdb8e09")));
    // FOF_NO_UI | FOFX_ADDUNDORECORD | FOFX_RECYCLEONDELETE, as Electron's trashItem uses.
    op.SetOperationFlags(0x0614 | 0x20000000 | 0x00080000);
    var probe = new RecycleProbe();
    op.DeleteItem(item, probe);
    op.PerformOperations();
    if (!probe.Seen) return "unknown";
    if (!probe.Recyclable) return "permanent";
    var capacity = Capacity(path);
    if (capacity < 0) return "unknown";
    return Size(path) > capacity ? "permanent" : "recyclable";
  }
}
"@
$paths = ConvertFrom-Json $env:ZHIYIN_RECYCLE_PATHS
foreach ($p in $paths) {
  try { [RecycleProbe]::Check($p) } catch { "unknown" }
}
`;

const scriptFile = join(
  tmpdir(),
  "zhiyin",
  `recycle-check-${createHash("sha256").update(script).digest("hex").slice(0, 12)}.ps1`,
);

/** Whether Windows would recycle each path; a path it could not tell about is left out. */
export async function checkRecyclable(
  paths: readonly string[],
  run: RunProcess = runProcess,
): Promise<ReadonlyMap<string, boolean>> {
  if (process.platform !== "win32" || !paths.length) return new Map();
  await mkdir(dirname(scriptFile), { recursive: true });
  await writeFile(scriptFile, script, "utf8");
  const powershell = join(
    process.env["SystemRoot"] ?? String.raw`C:\Windows`,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const outcome = await run({
    executable: powershell,
    arguments: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptFile,
    ],
    cwd: tmpdir(),
    timeoutMs: 30_000,
    environment: {
      ...process.env,
      ZHIYIN_RECYCLE_PATHS: JSON.stringify(paths),
    },
  });
  const answers = outcome.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const known = new Map<string, boolean>();
  if (outcome.exitCode !== 0 || answers.length !== paths.length) return known;
  paths.forEach((path, index) => {
    const answer = answers[index]!.trim();
    if (answer === "recyclable") known.set(path, true);
    else if (answer === "permanent") known.set(path, false);
  });
  return known;
}
