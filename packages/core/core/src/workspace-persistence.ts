import type { WorkspaceSnapshot } from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { Sessions } from "@zhiyin/session";

/** The core's one commit path and its visible failed-save state. */
export class WorkspacePersistence {
  private readonly sessions: Sessions;
  private readonly current: () => WorkspaceSnapshot;
  private readonly available: () => boolean;
  private readonly failed: () => void;
  private readonly succeeded: () => void;

  constructor(
    sessions: Sessions,
    current: () => WorkspaceSnapshot,
    available: () => boolean,
    failed: () => void,
    succeeded: () => void,
  ) {
    this.sessions = sessions;
    this.current = current;
    this.available = available;
    this.failed = failed;
    this.succeeded = succeeded;
  }

  async save(
    snapshot: WorkspaceSnapshot = this.current(),
    commit?: () => boolean,
  ): Promise<void> {
    if (!this.available())
      throw new VisibleError(
        "Saved history is unavailable. It has not been overwritten.",
      );
    try {
      if (commit) await this.sessions.saveWorkspace(snapshot, { commit });
      else await this.sessions.saveWorkspace(snapshot);
    } catch (error) {
      this.failed();
      throw error;
    }
    this.succeeded();
  }
}
