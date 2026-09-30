import type { WorkspaceIssue } from "@zhiyin/contract";

/**
 * What the person is being told is wrong. Each is said once, known by its
 * message; one about a conversation goes when that conversation does.
 */
export class Issues {
  #items: WorkspaceIssue[] = [];

  list(): WorkspaceIssue[] {
    return this.#items;
  }

  replace(items: readonly WorkspaceIssue[]): void {
    this.#items = [...items];
  }

  /** Answers whether it was not already being said. */
  add(notice: string | WorkspaceIssue): boolean {
    const issue = typeof notice === "string" ? { message: notice } : notice;
    if (this.#items.some((item) => item.message === issue.message))
      return false;
    this.#items = [...this.#items, issue];
    return true;
  }

  remove(message: string): void {
    this.#items = this.#items.filter((issue) => issue.message !== message);
  }

  forgetConversation(conversationId: string): void {
    this.#items = this.#items.filter(
      (issue) => issue.conversationId !== conversationId,
    );
  }
}
