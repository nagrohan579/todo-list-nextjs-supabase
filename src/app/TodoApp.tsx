"use client";
import { useOptimistic, useTransition, useRef, useState } from "react";
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
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [activeTodoId, setActiveTodoId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartRef = useRef<{ 
    id: string; 
    y: number; 
    element: HTMLLIElement;
    initialIndex: number;
    currentIndex: number;
  } | null>(null);

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
    reorderTodosById(draggedId, targetId);
  }

  // Touch handling for mobile
  function handleTouchStart(e: React.TouchEvent<HTMLLIElement>, id: string) {
    const touch = e.touches[0];
    const element = e.currentTarget;
    const initialIndex = optimisticTodos.findIndex(t => t.id === id);
    
    touchStartRef.current = { 
      id, 
      y: touch.clientY, 
      element,
      initialIndex,
      currentIndex: initialIndex
    };
    
    // Clear any existing timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    
    // Start long press timer (1000ms)
    longPressTimerRef.current = setTimeout(() => {
      activateDeleteMode(element);
    }, 1000);
    
    // Add subtle initial touch feedback
    element.style.backgroundColor = 'rgba(115, 115, 115, 0.1)';
  }
  
  function activateDeleteMode(element: HTMLLIElement) {
    const todoId = element.getAttribute('data-todo-id');
    if (!todoId) return;
    
    // Haptic feedback
    if ('vibrate' in navigator) {
      navigator.vibrate(100);
    }
    
    // Visual pulse animation for devices without vibration
    element.style.animation = 'pulse 0.3s ease-in-out';
    setTimeout(() => {
      element.style.animation = '';
    }, 300);
    
    // Enter delete mode and set active todo
    setIsDeleteMode(true);
    setActiveTodoId(todoId);
    
    // Add visual feedback for the selected todo - keep it enlarged
    element.style.zIndex = '50';
    element.style.transform = 'scale(1.05)';
    element.style.boxShadow = '0 8px 25px rgba(0,0,0,0.4)';
    element.style.backgroundColor = '';
    element.setAttribute('data-delete-mode-active', 'true');
  }

  function handleTouchMove(e: React.TouchEvent<HTMLLIElement>) {
    // Clear long press timer on move (indicates drag, not long press)
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      
      // Reset initial touch feedback
      if (touchStartRef.current) {
        touchStartRef.current.element.style.backgroundColor = '';
      }
    }
    
    // Allow drag if already in delete mode OR if we detect significant movement (drag intent)
    const touch = e.touches[0];
    const startY = touchStartRef.current?.y || touch.clientY;
    const currentY = touch.clientY;
    const deltaY = currentY - startY;
    const absDeltaY = Math.abs(deltaY);
    
    // Allow dragging regardless of delete mode if movement is significant
    if (absDeltaY <= 10) {
      // Small movement - allow normal scrolling only if not in delete mode
      if (!isDeleteMode) {
        return;
      }
    }
    
    e.preventDefault(); // Prevent scrolling when dragging
    
    if (!touchStartRef.current) return;
    
    // Visual feedback: move the dragged element (light scaling for drag, not delete mode scaling)
    touchStartRef.current.element.style.transform = `translateY(${deltaY}px) scale(1.02)`;
    touchStartRef.current.element.style.zIndex = '50';
    
    // Calculate which todo we're hovering over based on Y position
    const todoElements = Array.from(document.querySelectorAll('[data-todo-id]')) as HTMLElement[];
    const draggedElement = touchStartRef.current.element;
    const draggedRect = draggedElement.getBoundingClientRect();
    const draggedCenterY = draggedRect.top + draggedRect.height / 2 + deltaY;
    
    let newIndex = touchStartRef.current.initialIndex;
    
    // Find the closest todo element by center position
    for (let i = 0; i < todoElements.length; i++) {
      const el = todoElements[i];
      if (el === draggedElement) continue;
      
      const rect = el.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      
      if (draggedCenterY < centerY) {
        newIndex = Math.min(i, touchStartRef.current.initialIndex);
        break;
      } else {
        newIndex = Math.max(i, touchStartRef.current.initialIndex);
      }
    }
    
    // Only update if index changed
    if (newIndex !== touchStartRef.current.currentIndex) {
      touchStartRef.current.currentIndex = newIndex;
      updateTodoPositions(touchStartRef.current.initialIndex, newIndex);
    }
  }

  function updateTodoPositions(fromIndex: number, toIndex: number) {
    const todoElements = Array.from(document.querySelectorAll('[data-todo-id]')) as HTMLElement[];
    
    // Reset all transformations except the dragged one
    todoElements.forEach((el, index) => {
      if (el === touchStartRef.current?.element) return;
      
      let offset = 0;
      
      if (fromIndex < toIndex) {
        // Moving down: elements between original and new position shift up
        if (index > fromIndex && index <= toIndex) {
          offset = -1;
        }
      } else {
        // Moving up: elements between new and original position shift down  
        if (index >= toIndex && index < fromIndex) {
          offset = 1;
        }
      }
      
      if (offset !== 0) {
        const draggedHeight = touchStartRef.current?.element.offsetHeight || 0;
        const gap = 8; // gap between todos
        el.style.transform = `translateY(${offset * (draggedHeight + gap)}px)`;
        el.style.transition = 'transform 200ms ease';
      } else {
        el.style.transform = '';
        el.style.transition = 'transform 200ms ease';
      }
    });
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLLIElement>) {
    // Clear long press timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    
    if (!touchStartRef.current) return;
    
    const { initialIndex, currentIndex, element } = touchStartRef.current;
    
    // If position changed, perform reorder (regardless of delete mode)
    if (initialIndex !== currentIndex) {
      const current = optimisticTodos.slice();
      const [moved] = current.splice(initialIndex, 1);
      current.splice(currentIndex, 0, moved);
      
      startTransition(() => setOptimisticTodos(current));
      
      // Persist order: exclude optimistic temp-* ids to avoid server errors
      const stableIds = current.map(t => t.id).filter(id => !id.startsWith('temp-'));
      queueMicrotask(() => {
        if (stableIds.length) reorderTodos(stableIds);
      });
    }
    
    // Reset drag-related visual states but keep delete mode styling
    const todoElements = Array.from(document.querySelectorAll('[data-todo-id]')) as HTMLElement[];
    todoElements.forEach(el => {
      el.style.transition = '';
      // Only reset transform if it's not the active delete mode element
      if (!el.hasAttribute('data-delete-mode-active')) {
        el.style.transform = '';
      }
    });
    
    // Reset drag visual states
    if (element.hasAttribute('data-delete-mode-active')) {
      // Keep delete mode styling (enlarged and elevated)
      element.style.transform = 'scale(1.05)';
      element.style.opacity = '';
    } else {
      // Reset completely - no delete mode active
      element.style.transform = '';
      element.style.opacity = '';
      element.style.zIndex = '';
      element.style.boxShadow = '';
    }
    element.style.backgroundColor = '';
    
    touchStartRef.current = null;
    // Keep delete mode active until explicitly exited
  }
  
  function exitDeleteMode() {
    setIsDeleteMode(false);
    setActiveTodoId(null);
    
    // Reset all delete mode active elements
    const deleteActiveElements = document.querySelectorAll('[data-delete-mode-active="true"]');
    deleteActiveElements.forEach(el => {
      const element = el as HTMLElement;
      element.style.transform = '';
      element.style.opacity = '';
      element.style.zIndex = '';
      element.style.boxShadow = '';
      element.style.backgroundColor = '';
      element.removeAttribute('data-delete-mode-active');
    });
    
    // Clear any active touch state
    if (touchStartRef.current) {
      touchStartRef.current = null;
    }
    
    // Clear timer if running
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  // Shared reorder logic for both drag and touch
  function reorderTodosById(draggedId: string, targetId: string) {
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
    
    // Exit delete mode after deletion
    exitDeleteMode();
  }

  async function onClearCompleted() {
    startTransition(() =>
      setOptimisticTodos(optimisticTodos.filter((t) => !t.completed))
    );
    clearCompleted();
  }

  const completedCount = optimisticTodos.filter((t) => t.completed).length;

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
          }
          
          /* Prevent iOS drag preview and selection */
          [draggable="true"] {
            -webkit-user-drag: none;
            -webkit-user-select: none;
            -webkit-touch-callout: none;
          }
          
          /* Prevent iOS tap highlights */
          * {
            -webkit-tap-highlight-color: transparent;
          }
        `
      }} />
      <div className={`w-full max-w-lg mx-auto flex flex-col gap-6 ${isDeleteMode ? 'relative' : ''}`}>
        {isDeleteMode && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-30 z-40" 
            onClick={exitDeleteMode}
            style={{ backdropFilter: 'blur(1px)' }}
          />
        )}
      <form
        ref={formRef}
        action={onAdd}
        className={`flex gap-2 items-center relative z-50 ${isDeleteMode ? 'opacity-50 pointer-events-none' : ''}`}
        onClick={isDeleteMode ? exitDeleteMode : undefined}
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
              data-todo-id={todo.id}
              draggable
              onDragStart={(e) => handleDragStart(e, todo.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, todo.id)}
              onTouchStart={(e) => handleTouchStart(e, todo.id)}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onContextMenu={(e) => e.preventDefault()}
              className={`group rounded-md border border-neutral-700 bg-neutral-900/50 px-3 py-2 text-sm text-neutral-100 flex items-center gap-3 cursor-grab active:cursor-grabbing hover:border-neutral-500 touch-none select-none relative ${
                isDeleteMode ? 'z-50' : ''
              } ${
                isDeleteMode && activeTodoId && activeTodoId !== todo.id ? 'opacity-50 pointer-events-none' : ''
              }`}
              style={{
                WebkitTouchCallout: 'none',
                WebkitUserSelect: 'none',
                KhtmlUserSelect: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none',
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent'
              }}
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
                className={`flex-1 whitespace-pre-wrap leading-snug select-none ${
                  todo.completed ? "line-through text-neutral-500" : ""
                }`}
                style={{
                  WebkitUserSelect: 'none',
                  WebkitTouchCallout: 'none'
                }}
              >
                {todo.text}
              </span>
              <button
                type="button"
                onClick={() => onDelete(todo.id)}
                aria-label="Delete todo"
                className={`text-neutral-500 hover:text-red-400 transition-colors px-1 touch-manipulation ${
                  isDeleteMode 
                    ? 'opacity-100' 
                    : 'opacity-0 group-hover:opacity-80 group-active:opacity-80 group-focus-within:opacity-80'
                }`}
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
        <div className={`flex items-center justify-between text-xs text-neutral-500 pt-2 relative z-50 ${isDeleteMode ? 'opacity-50 pointer-events-none' : ''}`}>
          <span>
            {optimisticTodos.length - completedCount} active / {completedCount} completed
          </span>
          {completedCount > 0 && (
            <button
              type="button"
              onClick={isDeleteMode ? exitDeleteMode : onClearCompleted}
              className="underline decoration-dotted hover:text-neutral-300"
            >
              Clear completed
            </button>
          )}
        </div>
      )}
      </div>
    </>
  );
}
