/**
 * The scope of a conversation outside any project (ADR 0026), told apart
 * from everything the person does and from a project's id by its prefix.
 */

const conversationPrefix = "conversation:";

/** The scope a conversation outside any project keeps its own memory in. */
export function conversationScope(conversationId: string): string {
  return `${conversationPrefix}${conversationId}`;
}

/** The conversation a scope belongs to, or nothing for any other scope. */
export function conversationOfScope(scope: string): string | undefined {
  return scope.startsWith(conversationPrefix)
    ? scope.slice(conversationPrefix.length)
    : undefined;
}
