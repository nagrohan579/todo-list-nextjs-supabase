"use server";
import { revalidatePath } from "next/cache";
import crypto from "crypto";
import { getSupabase } from "@/lib/supabaseClient";

export type Todo = {
  id: string;
  text: string;
  completed: boolean;
  position: number;
};

async function fetchTodos(): Promise<Todo[]> {
  const { data, error } = await getSupabase()
    .from("todos")
    .select("id,text,completed,position")
    .order("position", { ascending: true });
  if (error) throw error;
  return data as Todo[];
}

export async function readTodos(): Promise<Todo[]> {
  return fetchTodos();
}

export async function addTodo(formData: FormData) {
  const text = (formData.get("text") || "").toString().trim();
  if (!text) return { ok: false, error: "Empty" } as const;
  // Determine new top position (we use integers; smaller = higher). We'll shift others via increment.
  const todos = await fetchTodos();
  const minPos = todos.length ? Math.min(...todos.map(t => t.position)) : 0;
  const newPos = minPos - 1; // place on top
  const newId = crypto.randomUUID();
  const { error } = await getSupabase().from("todos").insert({
    id: newId,
    text,
    completed: false,
    position: newPos,
  });
  if (error) throw error;
  revalidatePath("/");
  return { ok: true } as const;
}

export async function reorderTodos(newOrderIds: string[]) {
  const supabase = getSupabase();
  // Filter out any temporary client-only ids (e.g., optimistic temp-*) and non-UUID values
  const uuidIds = newOrderIds.filter((id) => /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$/.test(id));
  if (uuidIds.length === 0) return { ok: true } as const;

  // Try RPC function first (if created in DB); ignore if it errors with not found
  let rpcTried = false;
  try {
    rpcTried = true;
    const { error: rpcErr } = await supabase.rpc("reorder_todos", { ids: uuidIds });
    if (!rpcErr) {
      revalidatePath("/");
      return { ok: true } as const;
    }
  } catch {
    // fall through to manual updates
  }

  // Manual updates: assign sequential positions
  await Promise.all(
    uuidIds.map((id, index) =>
      supabase
        .from("todos")
        .update({ position: index })
        .eq("id", id)
    )
  );
  revalidatePath("/");
  return { ok: true } as const;
}

export async function toggleTodo(id: string) {
  const { data, error: fetchErr } = await getSupabase()
    .from("todos")
    .select("completed")
    .eq("id", id)
    .single();
  if (fetchErr) throw fetchErr;
  const { error } = await getSupabase()
    .from("todos")
    .update({ completed: !data.completed })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/");
  return { ok: true } as const;
}

export async function deleteTodo(id: string) {
  const { error } = await getSupabase().from("todos").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/");
  return { ok: true } as const;
}

export async function clearCompleted() {
  const { error } = await getSupabase().from("todos").delete().eq("completed", true);
  if (error) throw error;
  revalidatePath("/");
  return { ok: true } as const;
}
