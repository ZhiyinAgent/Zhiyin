import {
  conversationScope,
  projectOfConversation,
} from "@zhiyin/memory-projects";
import type { SidebarProject, SidebarTask } from "../sidebar/index.js";
import { listedConversations, type WindowState } from "./windowState.js";

type Listed = Pick<WindowState, "tasks" | "conversations" | "memory">;

/** The projects the sidebar shows: those memory keeps, archived ones aside. */
export function sidebarProjects(state: Listed): SidebarProject[] {
  return (state.memory?.projects ?? [])
    .filter((project) => !project.archived)
    .map(({ id, name }) => ({ id, name }));
}

/** Every conversation the sidebar lists, each in its project (ADR 0026). */
export function sidebarConversations(state: Listed): SidebarTask[] {
  const projects = state.memory?.projects ?? [];
  const entries = state.memory?.entries ?? [];
  return listedConversations(state).map((item) => {
    const project = projectOfConversation(item, projects);
    const its = conversationScope(item.id);
    const own = entries.filter((entry) => entry.scope === its).length;
    const general = entries.filter(
      (entry) =>
        entry.scope !== its &&
        entry.section === "knowledge" &&
        entry.conversation?.id === item.id,
    ).length;
    return {
      id: item.id,
      title: item.title,
      ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
      ...(item.needsUpdate ? { needsUpdate: true } : {}),
      ...(project ? { projectId: project.id } : {}),
      ...(item.memoryOff ? { memoryOff: true } : {}),
      ...(own || general ? { kept: { own, general } } : {}),
    };
  });
}
