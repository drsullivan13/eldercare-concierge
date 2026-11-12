import { useState } from "react";
import {
  Bookmark,
  Check,
  CheckCircle2,
  ClipboardList,
  Download,
  Plus,
  Trash2,
} from "lucide-react";
import type { Workspace } from "@/lib/workspace";
import type { useWorkspace } from "@/hooks/use-workspace";
import { TaskDialog } from "./task-dialog";

export function PlanView({
  workspace,
  update,
  addTask,
  exportPlan,
}: {
  workspace: Workspace;
  update: ReturnType<typeof useWorkspace>["update"];
  addTask: (
    title: string,
    providerId?: string,
    category?: string,
    dueDate?: string,
  ) => boolean;
  exportPlan: () => void;
}) {
  const [taskOpen, setTaskOpen] = useState(false);
  const completed = workspace.tasks.filter(
    (task) => task.status === "done",
  ).length;
  const pending = workspace.tasks.filter((task) => task.status === "todo");
  return (
    <>
      <>
        <div className="page-heading compact">
          <div>
            <span className="eyebrow">YOUR 90-DAY TRANSITION PLAN</span>
            <h1>
              One less thing <em>to hold.</em>
            </h1>
            <p>
              Make room for care, travel, equipment and everything in between.
            </p>
          </div>
          <button
            className="button button-primary"
            onClick={() => setTaskOpen(true)}
          >
            <Plus size={17} /> Add a next step
          </button>
        </div>
        <div className="plan-summary">
          <div>
            <CheckCircle2 size={24} />
            <strong>
              {completed}
              <span>completed</span>
            </strong>
          </div>
          <div>
            <ClipboardList size={24} />
            <strong>
              {pending.length}
              <span>still to do</span>
            </strong>
          </div>
          <div>
            <Bookmark size={24} />
            <strong>
              {workspace.savedProviderIds.length}
              <span>
                care{" "}
                {workspace.savedProviderIds.length === 1 ? "option" : "options"}{" "}
                saved
              </span>
            </strong>
          </div>
          <button className="text-link" onClick={exportPlan}>
            <Download size={16} /> Export your plan
          </button>
        </div>
        <div className="plan-table">
          <div className="plan-table-heading">
            <span>NEXT STEP</span>
            <span>CATEGORY</span>
            <span>DUE DATE</span>
            <span />
          </div>
          {workspace.tasks.map((task) => (
            <div
              key={task.id}
              className={`plan-task ${task.status === "done" ? "task-done" : ""}`}
            >
              <div>
                <button
                  className={`task-checkbox ${task.status === "done" ? "checked" : ""}`}
                  aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`}
                  onClick={() =>
                    update((w) => ({
                      ...w,
                      tasks: w.tasks.map((t) =>
                        t.id === task.id
                          ? {
                              ...t,
                              status: t.status === "done" ? "todo" : "done",
                            }
                          : t,
                      ),
                    }))
                  }
                >
                  {task.status === "done" && <Check size={13} />}
                </button>
                <span>{task.title}</span>
              </div>
              <span className="task-category">{task.category}</span>
              <span className="task-date">
                {task.dueDate
                  ? new Date(`${task.dueDate}T12:00:00`).toLocaleDateString(
                      "en-US",
                      {
                        month: "short",
                        day: "numeric",
                      },
                    )
                  : "No date set"}
              </span>
              <button
                className="icon-button"
                aria-label={`Delete ${task.title}`}
                onClick={() =>
                  update((w) => ({
                    ...w,
                    tasks: w.tasks.filter((t) => t.id !== task.id),
                  }))
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {workspace.tasks.length === 0 && (
            <div className="quiet-empty">
              <ClipboardList />
              <p>Add a next step to begin your plan.</p>
            </div>
          )}
          <button className="add-task-row" onClick={() => setTaskOpen(true)}>
            <Plus size={17} /> Add a next step
          </button>
        </div>
        <details className="plan-suggestions care-plan-suggestions">
          <summary>Ideas for your next steps</summary>
          <p>Use these prompts when they become relevant to your family.</p>
          <div>
            {[
              {
                title: "Coordinate a visit or care assessment",
                category: "Visits",
              },
              {
                title: "Check equipment and delivery arrangements",
                category: "Equipment",
              },
              {
                title: "Plan travel and who can be there",
                category: "Travel",
              },
              {
                title: "Organize cost and benefits questions",
                category: "Finances",
              },
              {
                title: "Plan the move and the first week",
                category: "Moving",
              },
              {
                title: "Agree on a family update routine",
                category: "Family",
              },
            ].map((item) => (
              <button
                key={item.title}
                onClick={() => addTask(item.title, undefined, item.category)}
              >
                <span>{item.title}</span>
                <Plus size={17} />
              </button>
            ))}
          </div>
        </details>
      </>

      {taskOpen && (
        <TaskDialog
          close={() => setTaskOpen(false)}
          save={(title, category, dueDate) => {
            if (addTask(title, undefined, category, dueDate))
              setTaskOpen(false);
          }}
        />
      )}
    </>
  );
}
