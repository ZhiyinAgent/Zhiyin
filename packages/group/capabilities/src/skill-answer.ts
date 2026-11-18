import type { PluginView } from "@zhiyin/plugins";
import { skillEntryId } from "./catalog.js";

type SkillView = PluginView["skills"][number];

/**
 * What opening `skill` answers: its instructions, then those of each skill it
 * needs from its own plugin, which opening it activates, then the ids of the
 * skills it needs from other plugins and of those it works with, to open. A
 * skill switched off, in a plugin switched off, or not there is left out,
 * since it is offered to no one.
 */
export function skillGuidance(
  skill: SkillView,
  plugin: string,
  views: readonly PluginView[],
): string {
  const usable = (id: string) => {
    const view = views.find((item) => item.skills.some((one) => one.id === id));
    const found = view?.skills.find((one) => one.id === id);
    return view?.enabled && found?.enabled ? { view, found } : undefined;
  };
  const delivered = [skill];
  for (const id of skill.needs ?? []) {
    const owned = usable(id);
    if (owned?.view.manifest.name === plugin) delivered.push(owned.found);
  }
  const inAnswer = new Set(delivered.map((one) => one.id));
  const named = (ids: readonly string[]) =>
    [...new Set(ids)].filter((id) => !inAnswer.has(id) && usable(id));
  const stillNeeded = named(delivered.flatMap((one) => one.needs ?? []));
  const worksWith = named(
    delivered.flatMap((one) => one.worksWith ?? []),
  ).filter((id) => !stillNeeded.includes(id));
  const listed = (ids: readonly string[]) =>
    ids.map((id) => skillEntryId(usable(id)!.found)).join(", ");

  const parts = [skill.instructions];
  for (const needed of delivered.slice(1))
    parts.push(
      "---",
      `${skillEntryId(needed)}, which this skill needs:`,
      needed.instructions,
    );
  const after = [
    ...(stillNeeded.length
      ? [
          `This skill also needs ${listed(stillNeeded)}: open ${stillNeeded.length === 1 ? "it" : "each"} now.`,
        ]
      : []),
    ...(worksWith.length
      ? [
          `Open as well each of these that applies to this work: ${listed(worksWith)}.`,
        ]
      : []),
  ];
  return [...parts, ...(after.length ? ["---", ...after] : [])].join("\n\n");
}
