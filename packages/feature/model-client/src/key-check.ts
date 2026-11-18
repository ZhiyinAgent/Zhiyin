/**
 * A lab's key checked by a request that spends nothing, such as its model
 * listing. The key is accepted when the lab answers, refused when the lab
 * refuses it, and any other answer is read as the lab reads a failed
 * request: a busy lab then says nothing about the key, and the check could
 * not be made.
 */

import {
  ModelClientError,
  errorObject,
  type FailureReport,
} from "./failures.js";
import type { CatalogFetch, KeyCheck } from "./provider.js";

export function keyCheckAt(
  lab: string,
  address: (region: string | undefined) => string,
  sign: (apiKey: string) => Readonly<Record<string, string>>,
  classify: (failure: FailureReport) => ModelClientError,
  /** The statuses by which the lab refuses a key. */
  refusals: readonly number[] = [401],
): (
  apiKey: string,
  fetcher: CatalogFetch,
  region?: string,
) => Promise<KeyCheck> {
  return async (apiKey, fetcher, region) => {
    const response = await fetcher(address(region), {
      headers: sign(apiKey),
    });
    if (response.ok) return { accepted: true };
    if (refusals.includes(response.status))
      return {
        accepted: false,
        error: new ModelClientError(
          "unauthorized",
          `${lab} rejected the API key.`,
        ),
      };
    const error = errorObject(await response.json().catch(() => undefined));
    return {
      accepted: false,
      error: classify({
        status: response.status,
        ...(error ? { error } : {}),
      }),
    };
  };
}
