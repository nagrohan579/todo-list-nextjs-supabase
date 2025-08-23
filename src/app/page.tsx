import { readTodos } from "./actions";
import { TodoApp } from "./TodoApp";

export const dynamic = "force-dynamic"; // ensure fresh read after actions

export default async function Home() {
  const todos = await readTodos();
  return (
    <main className="min-h-screen w-full px-4 py-12 md:py-16 font-sans bg-neutral-950 text-neutral-100">
      <div className="max-w-lg mx-auto flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Todos</h1>
          <p className="text-sm text-neutral-400">Add, drag to reorder. Stored locally in CSV.</p>
        </header>
        <TodoApp initial={todos} />
        <footer className="pt-8 mt-auto text-center text-[11px] text-neutral-500">
          <p>Data persists in <code>todos.csv</code> at project root.</p>
        </footer>
      </div>
    </main>
  );
}
