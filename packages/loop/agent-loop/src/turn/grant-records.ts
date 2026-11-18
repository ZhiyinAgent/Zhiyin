/** The grants a conversation holds, as the person gives, renews and revokes them. */

import type { ConversationPermission } from "@zhiyin/contract";
import type { TaskStore } from "./task-store.js";

export class GrantRecords {
  readonly #store: TaskStore;

  constructor(store: TaskStore) {
    this.#store = store;
  }

  async grant(
    taskId: string,
    permission: ConversationPermission,
  ): Promise<void> {
    const task = this.#store.task(taskId);
    await this.#store.replaceTask({
      ...task,
      conversationPermissions: [...task.conversationPermissions, permission],
    });
  }

  /** Replaces a grant, kept in its place, as by its id. */
  async update(
    taskId: string,
    permission: ConversationPermission,
  ): Promise<void> {
    const task = this.#store.task(taskId);
    await this.#store.replaceTask({
      ...task,
      conversationPermissions: task.conversationPermissions.map((granted) =>
        granted.id === permission.id ? permission : granted,
      ),
    });
  }

  async revoke(taskId: string, permissionId: string): Promise<void> {
    const task = this.#store.task(taskId);
    await this.#store.replaceTask({
      ...task,
      conversationPermissions: task.conversationPermissions.filter(
        (permission) => permission.id !== permissionId,
      ),
    });
  }
}
