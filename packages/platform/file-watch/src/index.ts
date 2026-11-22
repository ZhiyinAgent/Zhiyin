/**
 * Copy on first write for Windows: files held so that the first write,
 * rename or delete of each waits until it is saved, what changed on a
 * folder's drive between two points, from the NTFS change journal, and a
 * folder's listing, its links among it, kept up to date from that journal.
 */

export {
  FileWatch,
  type FileWatchEvents,
  type RoomDecision,
  type RoomRequest,
  type SavedFile,
  type WatchFailures,
  type WatchThread,
  type WatchThreadData,
} from "./file-watch.js";
export {
  contentReasons,
  journalChanges,
  journalPoint,
  type JournalChanges,
  type JournalPoint,
} from "./change-journal.js";
export {
  FolderIndex,
  type FolderJournal,
  type FolderListing,
  type FolderPart,
  type ListFolder,
} from "./folder-index.js";
export { alternateStreams } from "./streams.js";
export { sourceWatchThread } from "./source-thread.js";
