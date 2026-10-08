import type { ShellAvailability } from "@zhiyin/contract";
import type { Capabilities } from "@zhiyin/capabilities";

type ShellCapabilities = Pick<
  Capabilities,
  "shellAvailability" | "recheckShell"
>;

/** Whether the shell tool can run here, and re-detecting it without a restart. */
export class WorkspaceShell {
  readonly #capabilities: ShellCapabilities;

  constructor(capabilities: ShellCapabilities) {
    this.#capabilities = capabilities;
  }

  async availability(): Promise<ShellAvailability> {
    return this.#capabilities.shellAvailability();
  }

  async recheck(): Promise<ShellAvailability> {
    return this.#capabilities.recheckShell();
  }
}
