import { validateWorkspace, type Workspace } from "./workspace";

export function parseDemoImport(
  stored: string | null,
  defaults: Workspace,
): Workspace | null {
  if (!stored) return null;
  try {
    const checked = validateWorkspace(JSON.parse(stored));
    if (!checked.ok) return null;
    const workspace = checked.workspace;
    const profile = workspace.profile;
    const starterTasks = new Map(defaults.tasks.map((task) => [task.id, task]));
    const meaningful =
      profile.name.trim() !== "" ||
      (profile.relationship.trim() !== "" &&
        profile.relationship !== defaults.profile.relationship) ||
      (profile.zip !== "" && profile.zip !== defaults.profile.zip) ||
      profile.careTypes.length > 0 ||
      workspace.savedProviderIds.length > 0 ||
      Object.values(workspace.notes).some((note) => note.trim() !== "") ||
      (workspace.outreach?.length ?? 0) > 0 ||
      workspace.tasks.some((task) => {
        const starter = starterTasks.get(task.id);
        return (
          !starter ||
          task.title !== starter.title ||
          task.category !== starter.category ||
          task.dueDate !== starter.dueDate ||
          task.status !== starter.status ||
          task.providerId !== starter.providerId
        );
      });
    return meaningful ? workspace : null;
  } catch {
    return null;
  }
}
