/**
 * Offline ranking of catalog entries for a query, and matching a failed
 * script's error to the known API changes it shows (ADR 0017, ADR 0024).
 */

export {
  catalogIndex,
  type CatalogIndex,
  type CatalogMatch,
  type CatalogSearch,
} from "./catalog-index.js";
export { matchBreaks } from "./api-breaks.js";
