/**
 * The members this group joins, each its owner's fake (ADR 0002), for the
 * tests of the packages above it. There is no 3D studio, CAD studio or
 * command jobs: a test that needs one adds its own.
 */

import { fakeBrowsers } from "@zhiyin/interactive-browser/testing";
import { fakeMcp } from "@zhiyin/mcp/testing";
import { pluginsOffering } from "@zhiyin/plugins/testing";
import { fakeToolchains } from "@zhiyin/toolchains/testing";
import { fakeTools } from "@zhiyin/tools/testing";
import type { CapabilityMembers } from "../src/index.js";

/** Every member answering plainly and reaching nothing, offering no plugin. */
export function fakeMembers(): Pick<
  CapabilityMembers,
  | "tools"
  | "mcp"
  | "plugins"
  | "toolchains"
  | "connectionToolchains"
  | "browsers"
> {
  return {
    tools: fakeTools(),
    mcp: fakeMcp(),
    plugins: pluginsOffering([]),
    toolchains: fakeToolchains(),
    connectionToolchains: {},
    browsers: fakeBrowsers(),
  };
}
