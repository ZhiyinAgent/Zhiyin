/**
 * The thread of the main process that compares two pictures' pixels for the
 * model's tools. The pixels were drawn in the contained drawing process (ADR
 * 0019); this thread decodes nothing, and only does the arithmetic the core
 * would otherwise wait on.
 */

import { parentPort } from "node:worker_threads";
import { serveComparisons } from "@zhiyin/picture-comparison";

if (!parentPort) throw new Error("The picture thread has no parent.");
serveComparisons(parentPort);
