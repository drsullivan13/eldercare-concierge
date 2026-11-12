import { CATEGORY_LABELS, type Provider } from "@/lib/providers";
import type { Workspace } from "@/lib/workspace";

/** The saved workspace is authoritative even when provider hydration is incomplete. */
export function carePlanText(
  workspace: Workspace,
  providers: Provider[],
  searchZip: string,
  exportedAt = new Date(),
) {
  const records = new Map(providers.map((provider) => [provider.id, provider]));
  return [
    "# Harbor care research plan",
    `Exported ${exportedAt.toLocaleDateString("en-US")}`,
    "",
    `Search area: ${workspace.profile.zip || searchZip}`,
    "",
    "## Shortlist",
    ...workspace.savedProviderIds.flatMap((id) => {
      const provider = records.get(id);
      return [
        `### ${provider?.name || id}`,
        `Provider ID: ${id}`,
        ...(provider
          ? [
              `${CATEGORY_LABELS[provider.category]} · ${provider.address}, ${provider.city} ${provider.zip}`,
              ...provider.sources.map(
                (source) =>
                  `- ${source.title}: ${source.url} (retrieved ${source.checkedAt})`,
              ),
            ]
          : [
              "Provider details could not be loaded. This saved option and its notes are retained below.",
            ]),
        workspace.notes[id] ? `Notes: ${workspace.notes[id]}` : "",
        "",
      ];
    }),
    "## Other provider notes",
    ...Object.entries(workspace.notes)
      .filter(([id, note]) => note && !workspace.savedProviderIds.includes(id))
      .flatMap(([id, note]) => [
        `### ${records.get(id)?.name || id}`,
        `Provider ID: ${id}`,
        note,
        "",
      ]),
    "## Next steps",
    ...workspace.tasks.map(
      (task) =>
        `- [${task.status === "done" ? "x" : " "}] ${task.title}${task.dueDate ? ` · Due ${task.dueDate}` : ""} · ${task.category}${task.providerId ? ` · Provider: ${task.providerId}` : ""}`,
    ),
    "",
    "Provider availability, costs and personal fit require confirmation.",
  ].join("\n");
}
