/**
 * Waiting in tests for what they check: woken by what the code under test
 * does, never by a clock.
 */

export { changed, until, watched } from "./test-waits.js";
