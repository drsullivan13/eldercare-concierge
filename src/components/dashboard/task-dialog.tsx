import { useState } from "react";
import { Plus } from "lucide-react";
import { Modal } from "../modal";
const TASK_CATEGORIES = [
  "Research",
  "Care",
  "Visits",
  "Equipment",
  "Travel",
  "Finances",
  "Moving",
  "Family",
];

export function TaskDialog({
  save,
  close,
}: {
  save: (title: string, category: string, dueDate: string) => void;
  close: () => void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Research");
  const [dueDate, setDueDate] = useState("");
  return (
    <Modal title="Add a next step" close={close}>
      <span className="eyebrow">KEEP IT MOVING</span>
      <h2>What’s the next step?</h2>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) save(title.trim(), category, dueDate);
        }}
      >
        <label>
          Task
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="For example, schedule a visit"
            maxLength={200}
            required
            autoFocus
          />
        </label>
        <div className="form-two-cols">
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {TASK_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Due date <span className="muted">(optional)</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>
        <button className="button button-primary full-width">
          Add to my plan <Plus size={16} />
        </button>
      </form>
    </Modal>
  );
}
