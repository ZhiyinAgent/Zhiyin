import { useRef, useState } from "react";
import type {
  MemoryChange,
  MemoryEntry,
  MemoryRequest,
  MemoryState,
} from "@zhiyin/contract";
import {
  MemoryPage,
  TurnMemory,
  type TurnMemoryChange,
} from "../../ui/memory/index.js";
import { AppSidebar } from "../../ui/sidebar/index.js";
import { changedMemory, demoMemory } from "../fixtures/memory.js";
import type { ComponentCatalogEntry } from "./entry.js";

export const memoryEntries: ComponentCatalogEntry[] = [
  {
    id: "memory-page",
    title: "Memory page",
    description:
      "What Zhiyin keeps between conversations (ADR 0026): scopes on the left; about you, how to work and a project's brief read in full; knowledge as rows; an entry opened as a page with its links, what links to it, editing and Undo.",
    render: () => <MemoryExample start={demoMemory} />,
  },
  {
    id: "memory-page-empty",
    title: "Memory page, nothing kept yet",
    description: "A first visit: one line on how memory fills.",
    render: () => (
      <MemoryExample start={{ ...demoMemory, entries: [], waiting: [] }} />
    ),
  },
  {
    id: "memory-page-off",
    title: "Memory page, turned off",
    description:
      "What is kept stays readable; nothing new is kept and nothing is sent.",
    render: () => <MemoryExample start={{ ...demoMemory, on: false }} />,
  },
  {
    id: "memory-page-loading",
    title: "Memory page, loading and unreadable",
    description:
      "While the memory folder is read, and when it could not be read.",
    render: () => (
      <>
        <MemoryExample start={undefined} />
        <MemoryExample
          start={undefined}
          failure="The memory folder could not be read: access is denied."
        />
      </>
    ),
  },
  {
    id: "sidebar-projects",
    title: "Projects in the sidebar",
    description:
      "Projects above the recent conversations, in the order of their latest conversation: the one holding the open conversation is open, the others open on their row, with + to start a conversation in one. Recent holds what belongs to no project.",
    render: () => (
      <div className="lab-sidebar" style={{ width: 260, height: 620 }}>
        <AppSidebar
          selectedId="ch3"
          onSelect={() => undefined}
          onNewTask={() => undefined}
          onNewTaskInProject={() => undefined}
          onMoveToProject={() => undefined}
          onKeepNothingFrom={() => undefined}
          onTaskPermissions={() => undefined}
          onDeleteTask={() => undefined}
          projects={[
            { id: "thesis", name: "Thesis" },
            { id: "kitchen", name: "Kitchen renovation" },
            { id: "tessera", name: "Tessera v2" },
            { id: "club", name: "Running club newsletter" },
          ]}
          tasks={[
            {
              id: "ch3",
              title: "Chapter 3 proofreading",
              updatedAt: "2026-10-31T11:20:00.000Z",
              projectId: "thesis",
              kept: { own: 0, general: 3 },
            },
            {
              id: "card",
              title: "Birthday card for Léa",
              updatedAt: "2026-10-31T09:00:00.000Z",
            },
            {
              id: "search",
              title: "Slow stock search at 500 users",
              updatedAt: "2026-10-30T16:00:00.000Z",
              projectId: "tessera",
            },
            {
              id: "data",
              title: "Cleaning the 2025 sensor data",
              updatedAt: "2026-10-28T11:00:00.000Z",
              projectId: "thesis",
            },
            {
              id: "tax",
              title: "Tax return questions",
              updatedAt: "2026-10-27T18:00:00.000Z",
              memoryOff: true,
            },
            {
              id: "quotes",
              title: "Kitchen quotes",
              updatedAt: "2026-10-26T19:00:00.000Z",
              projectId: "kitchen",
            },
            {
              id: "lit",
              title: "Literature review, LCZ studies",
              updatedAt: "2026-10-10T09:00:00.000Z",
              projectId: "thesis",
            },
            {
              id: "template",
              title: "Thesis template setup",
              updatedAt: "2026-10-03T09:00:00.000Z",
              projectId: "thesis",
            },
            {
              id: "trip",
              title: "Weekend in Annecy",
              updatedAt: "2026-10-02T09:00:00.000Z",
              kept: { own: 2, general: 1 },
            },
          ]}
        />
      </div>
    ),
  },
  {
    id: "turn-memory",
    title: "What a turn kept in memory",
    description:
      "Under the turn, beside the files it changed: what was kept, changed or merged, where, and Undo for each; what the look back kept after the turn; a change to how Zhiyin works that waits for the person, with why on its i; and the same card once acted on.",
    render: () => (
      <div className="lab-stack">
        <TurnMemoryExample
          start={[
            {
              writeId: "w1",
              number: 41,
              title: "Typst over LaTeX",
              change: "added",
              scope: "thesis",
              scopeName: "Thesis",
              section: "knowledge",
            },
            {
              writeId: "w2",
              number: 4,
              title: "How to work",
              change: "changed",
              scope: "thesis",
              scopeName: "Thesis",
              section: "how",
            },
          ]}
        />
        <TurnMemoryExample
          start={[
            {
              writeId: "w3",
              number: 13,
              title: "University template rules",
              change: "changed",
              scope: "thesis",
              scopeName: "Thesis",
              section: "knowledge",
            },
            {
              writeId: "w4",
              number: 44,
              title: "Template margins",
              change: "removed",
              scope: "thesis",
              scopeName: "Thesis",
              section: "knowledge",
              mergedInto: 13,
            },
          ]}
        />
        <TurnMemoryExample
          start={[
            {
              writeId: "w7",
              number: 51,
              title: "Flights booked",
              change: "added",
              scope: "conversation:conversation-6",
              scopeName: "This conversation",
              section: "knowledge",
              afterTurn: true,
            },
          ]}
        />
        <TurnMemoryExample
          start={[
            {
              writeId: "w5",
              number: 30,
              title: "Météo-France open data",
              change: "added",
              scope: "everything",
              scopeName: "Everything you do",
              section: "knowledge",
            },
            {
              writeId: "w6",
              number: 2,
              title: "How to work",
              change: "waiting",
              scope: "everything",
              scopeName: "Everything you do",
              section: "how",
              waiting: {
                id: "waiting-1",
                rule: "In French text, use non-breaking spaces before : ; ? and !",
                because: "content from a web page",
              },
            },
          ]}
        />
      </div>
    ),
  },
];

/** The card holding its own changes, so Undo, Keep and Discard work. */
function TurnMemoryExample({ start }: { start: readonly TurnMemoryChange[] }) {
  const [changes, setChanges] = useState(start);
  const mark = (
    matches: (change: MemoryChange) => boolean,
    state: MemoryChange["state"],
  ) =>
    setChanges((before) =>
      before.map((change) => (matches(change) ? { ...change, state } : change)),
    );
  return (
    <TurnMemory
      changes={changes}
      onOpen={() => undefined}
      onChange={async (request) => {
        if (request.kind === "undo")
          mark((change) => change.writeId === request.writeId, "undone");
        if (request.kind === "keep" || request.kind === "discard")
          mark(
            (change) => change.waiting?.id === request.waitingId,
            request.kind === "keep" ? "kept" : "discarded",
          );
        return { ok: true };
      }}
    />
  );
}

/** The page holding its own memory, so every control works in the lab. */
function MemoryExample({
  start,
  failure,
}: {
  start: MemoryState | undefined;
  failure?: string;
}) {
  const [memory, setMemory] = useState(start);
  const removed = useRef(new Map<string, MemoryEntry>());
  return (
    <MemoryPage
      memory={memory}
      failure={failure}
      onChange={async (request: MemoryRequest) => {
        if (!memory) return { ok: false, reason: "Memory is not read yet." };
        const changed = changedMemory(memory, request, removed.current);
        setMemory(changed.memory);
        return changed.outcome;
      }}
      onOpenFolder={async () => undefined}
      onClose={() => undefined}
    />
  );
}
