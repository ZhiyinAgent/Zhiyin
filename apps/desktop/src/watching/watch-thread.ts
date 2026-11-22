/**
 * The thread of the main process that holds the files a turn may change, so
 * the first write of each waits until it is saved (ADR 0031). It runs on its
 * own, whatever the main thread is doing.
 */

import "@zhiyin/file-watch/thread";
