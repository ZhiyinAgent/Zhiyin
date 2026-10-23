/**
 * The model list this version ships with, read the same strict way as one
 * downloaded later, for the labs this version reaches.
 */

import shippedFile from "../model-list/models.json";
import {
  readModelList,
  type LabPlatforms,
  type ModelListFile,
} from "./model-list-format.js";
import { ONE_PLATFORM, type ModelLists } from "./model-list.js";
import { everyProvider } from "./providers/index.js";

/** Every lab this version reaches, with its platforms. */
export const labPlatforms: LabPlatforms = new Map(
  everyProvider.flatMap((provider) =>
    "listed" in provider
      ? [
          [
            provider.id,
            provider.regions?.map((region) => region.id) ?? [ONE_PLATFORM],
          ] as const,
        ]
      : [],
  ),
);

function shipped(): ModelListFile {
  const reading = readModelList(shippedFile, labPlatforms);
  if (!reading.ok)
    throw new Error(
      `The model list Zhiyin ships is unreadable: ${reading.problem}`,
    );
  return reading.list;
}

export const shippedModelList: ModelListFile = shipped();

/** The shipped list as the labs read it, where no update is handed in. */
export const shippedModelLists: ModelLists = {
  lab: (provider) => shippedModelList.labs[provider],
};
