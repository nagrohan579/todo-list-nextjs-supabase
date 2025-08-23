"use client";
import { useOptimistic, useTransition, useRef } from "react";
import type { Todo } from "./actions";
import {
  addTodo,
  reorderTodos,
  toggleTodo,
  deleteTodo,
  clearCompleted,
} from "./actions";

interface Props {
  initial: Todo[];
}

export function TodoApp({ initial }: Props) {
  // useOptimistic requires an update function in React 19; we treat the action as the next full array
  const [optimisticTodos, setOptimisticTodos] = useOptimistic(
    initial,
    (_current: Todo[], next: Todo[]) => next
  );
  const [isPending, startTransition] = useTransition(); // still available if you want to show subtle state later
  const formRef = useRef<HTMLFormElement>(null);

  async function onAdd(formData: FormData) {
    const text = (formData.get("text") || "").toString().trim();
    if (!text) return;
    // Optimistic add immediately
    startTransition(() => {
      const minPos = optimisticTodos.length
        ? Math.min(...optimisticTodos.map(t => t.position ?? 0))
        : 0;
      const temp: Todo = { id: `temp-${Date.now()}`, text, completed: false, position: minPos - 1 };
      setOptimisticTodos([temp, ...optimisticTodos]);
    });
    // Clear input instantly for snappy UX
    formRef.current?.reset();
    // Fire server action without awaiting to avoid blocking UI reset
    addTodo(formData).catch(() => {
      // Optional: could rollback or show an error toast here
    });
  }

  // Drag state handling
  function handleDragStart(e: React.DragEvent<HTMLLIElement>, id: string) {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }
  function handleDragOver(e: React.DragEvent<HTMLLIElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
  function handleDrop(
    e: React.DragEvent<HTMLLIElement>,
    targetId: string
  ) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId || draggedId === targetId) return;
    const current = optimisticTodos.slice();
    const fromIdx = current.findIndex((t) => t.id === draggedId);
    const toIdx = current.findIndex((t) => t.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = current.splice(fromIdx, 1);
    current.splice(toIdx, 0, moved);
  startTransition(() => setOptimisticTodos(current));
    // Persist order: exclude optimistic temp-* ids to avoid server errors
    const stableIds = current.map(t => t.id).filter(id => !id.startsWith('temp-'));
    // Debounce by using a micro-task (prevents multiple rapid drops stacking)
    queueMicrotask(() => {
      if (stableIds.length) reorderTodos(stableIds);
    });
  }

  async function onToggle(id: string) {
    // optimistic toggle
    startTransition(() =>
      setOptimisticTodos(
        optimisticTodos.map((t) =>
          t.id === id ? { ...t, completed: !t.completed } : t
        )
      )
    );
    toggleTodo(id);
  }

  async function onDelete(id: string) {
    startTransition(() =>
      setOptimisticTodos(optimisticTodos.filter((t) => t.id !== id))
    );
    deleteTodo(id);
  }

  async function onClearCompleted() {
    startTransition(() =>
      setOptimisticTodos(optimisticTodos.filter((t) => !t.completed))
    );
    clearCompleted();
  }

  const completedCount = optimisticTodos.filter((t) => t.completed).length;

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-6">
      <form
        ref={formRef}
        action={onAdd}
        className="flex gap-2 items-center"
      >
        <input
          name="text"
          placeholder="Add a task..."
          className="flex-1 rounded-md bg-neutral-900/60 border border-neutral-700 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500"
          autoComplete="off"
        />
        <button
          type="submit"
          className="rounded-md bg-neutral-100 text-neutral-900 text-sm px-4 py-2 font-medium hover:bg-white"
        >Add</button>
      </form>
      <ul className="flex flex-col gap-2" aria-live="polite">
        {optimisticTodos.length === 0 && (
          <li className="text-sm text-neutral-500 text-center py-8 border border-dashed border-neutral-700 rounded-md">
            No tasks yet. Add your first one above.
          </li>
        )}
        {optimisticTodos.map((todo) => {
          const line = (
            <li
              key={todo.id}
              draggable
              onDragStart={(e) => handleDragStart(e, todo.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, todo.id)}
              className="group rounded-md border border-neutral-700 bg-neutral-900/50 px-3 py-2 text-sm text-neutral-100 flex items-center gap-3 cursor-grab active:cursor-grabbing transition-colors hover:border-neutral-500"
            >
              <button
                type="button"
                onClick={() => onToggle(todo.id)}
                className={`h-4 w-4 flex items-center justify-center rounded-sm border text-[10px] font-bold transition-colors ${
                  todo.completed
                    ? "border-neutral-500 bg-neutral-700 text-neutral-200"
                    : "border-neutral-600 hover:border-neutral-400"
                }`}
                aria-label={todo.completed ? "Mark incomplete" : "Mark complete"}
              >
                {todo.completed ? "✓" : ""}
              </button>
              <span
                className={`flex-1 whitespace-pre-wrap leading-snug ${
                  todo.completed ? "line-through text-neutral-500" : ""
                }`}
              >
                {todo.text}
              </span>
              <button
                type="button"
                onClick={() => onDelete(todo.id)}
                aria-label="Delete todo"
                className="opacity-0 group-hover:opacity-80 text-neutral-500 hover:text-red-400 transition-colors px-1"
              >
                ×
              </button>
              <span className="opacity-0 group-hover:opacity-60 text-[10px] tracking-wide text-neutral-400">drag</span>
            </li>
          );
          return line;
        })}
      </ul>
      {optimisticTodos.length > 0 && (
        <div className="flex items-center justify-between text-xs text-neutral-500 pt-2">
          <span>
            {optimisticTodos.length - completedCount} active / {completedCount} completed
          </span>
          {completedCount > 0 && (
            <button
              type="button"
              onClick={onClearCompleted}
              className="underline decoration-dotted hover:text-neutral-300"
            >
              Clear completed
            </button>
          )}
        </div>
      )}
    </div>
  );
}
