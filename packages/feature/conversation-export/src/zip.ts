import { crc32, deflateRawSync } from "node:zlib";

/** One file inside an archive, by its path there. */
export type ArchivedFile = {
  readonly path: string;
  readonly data: Uint8Array;
};

/** The flag saying names are UTF-8. */
const utf8Names = 0x0800;
const deflated = 8;
const version = 20;

function dosTime(at: Date): { readonly time: number; readonly date: number } {
  return {
    time:
      (at.getHours() << 11) |
      (at.getMinutes() << 5) |
      Math.floor(at.getSeconds() / 2),
    date:
      ((Math.max(at.getFullYear(), 1980) - 1980) << 9) |
      ((at.getMonth() + 1) << 5) |
      at.getDate(),
  };
}

/**
 * A .zip of `files`, each compressed, as every archiver on Windows opens.
 * Large archives need a format extension this does not write, so one past
 * four gigabytes is refused rather than written wrong.
 */
export function zipArchive(
  files: readonly ArchivedFile[],
  modifiedAt: Date,
): Uint8Array {
  if (files.length > 0xffff)
    throw new Error("The archive would hold more files than it can name.");
  const { time, date } = dosTime(modifiedAt);
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const compressed = deflateRawSync(file.data);
    const checksum = crc32(file.data);
    if (offset + compressed.length > 0xffffffff)
      throw new Error("The archive would pass four gigabytes.");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(version, 4);
    local.writeUInt16LE(utf8Names, 6);
    local.writeUInt16LE(deflated, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(version, 4);
    central.writeUInt16LE(version, 6);
    central.writeUInt16LE(utf8Names, 8);
    central.writeUInt16LE(deflated, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    parts.push(local, name, compressed);
    directory.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}
