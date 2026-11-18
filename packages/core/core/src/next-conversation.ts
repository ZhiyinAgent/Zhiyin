/**
 * The conversation shown once the one on screen is deleted: the next in the
 * list's order, opened. One deleted too while it was read gives its place to
 * the one now there, and one that cannot be read leaves the window on no
 * conversation.
 */

export type NextConversation = {
  /** The conversations as the list now orders them. */
  readonly listed: () => readonly { readonly id: string }[];
  readonly exists: (taskId: string) => boolean;
  /** Reads a conversation and answers whether it opened. */
  readonly open: (taskId: string) => Promise<boolean>;
  /** Whether the window still waits for this choice; false once the person went elsewhere. */
  readonly wanted: () => boolean;
};

/** Answers the conversation to show, or none. */
export async function nextConversation(
  first: string | null,
  deps: NextConversation,
): Promise<string | null> {
  let candidate = first;
  let open = false;
  while (candidate !== null && deps.wanted()) {
    const place = deps.listed().findIndex((item) => item.id === candidate);
    open = await deps.open(candidate);
    if (deps.exists(candidate)) break;
    const listed = deps.listed();
    candidate = listed[Math.min(place, listed.length - 1)]?.id ?? null;
  }
  return open ? candidate : null;
}
