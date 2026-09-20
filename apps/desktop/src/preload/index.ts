/**
 * The bridge, and the entire surface the renderer is given. It exposes exactly
 * the contract's `CoreApi` — no Node, no Electron, no filesystem — and contains
 * no logic of its own.
 */

import { contextBridge, ipcRenderer } from "electron";
import {
  BRIDGE_KEY,
  CHANNEL,
  COMMAND_CHANNELS,
  type AppEvent,
  type Commands,
  type CoreApi,
  type ViewCheckRequest,
} from "@zhiyin/contract";

/**
 * One function per command, sending its arguments exactly as given. The names
 * come from the channel list, so the bridge offers exactly the commands that
 * travel.
 */
const commands = Object.fromEntries(
  Object.entries(COMMAND_CHANNELS).map(([name, channel]) => [
    name,
    (...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  ]),
) as Commands;

const api: CoreApi = {
  ...commands,

  onAppEvent: (handler: (event: AppEvent) => void) => {
    const listener = (_event: unknown, payload: AppEvent): void =>
      handler(payload);
    ipcRenderer.on(CHANNEL.appEvent, listener);
    return () => {
      ipcRenderer.off(CHANNEL.appEvent, listener);
    };
  },

  onViewCheck: (handler: (request: ViewCheckRequest) => void) => {
    const listener = (_event: unknown, payload: ViewCheckRequest): void =>
      handler(payload);
    ipcRenderer.on(CHANNEL.viewCheck, listener);
    return () => {
      ipcRenderer.off(CHANNEL.viewCheck, listener);
    };
  },
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, api);
