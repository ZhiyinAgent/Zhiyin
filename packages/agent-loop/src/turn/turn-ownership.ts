type OwnedTurn = {
  readonly controller: AbortController;
  readonly parentId?: string;
};

/** The lifecycle tree for root turns and any work they delegate. */
export class TurnOwnership {
  readonly #turns = new Map<string, OwnedTurn>();

  start(id: string, parentId?: string): AbortController {
    if (this.#turns.has(id)) throw new Error("The turn is already running.");
    if (parentId && !this.#turns.has(parentId))
      throw new Error("The parent turn is not running.");
    const controller = new AbortController();
    this.#turns.set(id, { controller, ...(parentId ? { parentId } : {}) });
    return controller;
  }

  controller(id: string): AbortController | undefined {
    return this.#turns.get(id)?.controller;
  }

  owns(id: string, controller: AbortController): boolean {
    return this.#turns.get(id)?.controller === controller;
  }

  running(id: string): boolean {
    return this.#turns.has(id);
  }

  anyRunning(exceptId?: string): boolean {
    return [...this.#turns.keys()].some((id) => id !== exceptId);
  }

  cancel(id: string): void {
    for (const descendant of this.#descendantsOf(id).reverse())
      this.#end(descendant, true);
    this.#end(id, true);
  }

  /**
   * A turn that finished on its own, rather than being stopped, leaves its
   * still-running descendants alone: a specialist may now outlive the turn
   * that started it, running in the background after control has returned
   * to the person. Only `cancel` ends a whole branch together.
   */
  finish(id: string, controller: AbortController): boolean {
    if (!this.owns(id, controller)) return false;
    this.#end(id, false);
    return true;
  }

  cancelAll(): void {
    for (const id of [...this.#turns.keys()]) this.#end(id, true);
  }

  #descendantsOf(id: string): string[] {
    const found: string[] = [];
    const visit = (parentId: string) => {
      for (const [childId, turn] of this.#turns) {
        if (turn.parentId !== parentId) continue;
        found.push(childId);
        visit(childId);
      }
    };
    visit(id);
    return found;
  }

  #end(id: string, abort: boolean): void {
    const turn = this.#turns.get(id);
    if (!turn) return;
    if (abort) turn.controller.abort();
    this.#turns.delete(id);
  }
}
