import type { ComponentProps } from "react";
import {
  modelListWords,
  useModelList,
  type ModelListCommands,
} from "../model/index.js";
import { AppSettings } from "../settings/index.js";

/**
 * Settings with Zhiyin's list of models and prices (ADR 0027), read, and
 * looked over for a newer one, only while Settings is open.
 */
export function SettingsWithModelList({
  list,
  ...settings
}: ComponentProps<typeof AppSettings> & { list: ModelListCommands }) {
  const modelList = useModelList(list);
  return (
    <AppSettings
      {...settings}
      {...(modelList.state
        ? {
            modelList: {
              words: modelListWords(modelList.state, modelList.checking),
              updates: modelList.state.updates,
              onUpdates: modelList.setUpdates,
            },
          }
        : {})}
    />
  );
}
