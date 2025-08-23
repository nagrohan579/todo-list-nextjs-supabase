## Minimal Drag & Drop TODO (Server Actions + Supabase persistence)

This app is a tiny TODO list built on Next.js App Router + Server Actions. Persistence is handled by Supabase (Postgres). No custom API routes.

### Features
* Add a todo from the input at the top (Enter or click Add). New items appear at the top.
* Mark complete / incomplete with a checkbox (strike-through style).
* Delete individual todos.
* Clear all completed todos with one action.
* Drag & drop to reorder (native HTML5). Order is persisted immediately via a server action.
* Dark, minimal, keyboard accessible UI.
* Data stored in a Supabase `todos` table (see schema below).

### Running Locally
```bash
npm install
npm run dev
```
Visit http://localhost:3000

Create `.env.local` with:
```
NEXT_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_URL
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
# Or optionally (more secure writes) use service role for server actions only:
# SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

Run the SQL in the next section inside the Supabase SQL Editor (or psql) to create schema.
### Database Schema (SQL)
```sql
-- Enable required extensions (some already enabled in Supabase projects)
create extension if not exists "uuid-ossp";

-- Core table
create table if not exists public.todos (
	id uuid primary key default uuid_generate_v4(),
	text text not null,
	completed boolean not null default false,
	position integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

-- Keep updated_at current
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
	new.updated_at = now();
	return new;
end;$$;

drop trigger if exists trg_todos_updated_at on public.todos;
create trigger trg_todos_updated_at
before update on public.todos
for each row execute function public.set_updated_at();

-- Helpful index for ordering + quick lookups
create index if not exists idx_todos_position on public.todos(position asc);
create index if not exists idx_todos_completed on public.todos(completed);

-- View giving ordered todos (simplifies selects if desired)
create or replace view public.todos_ordered as
	select id, text, completed, position, created_at, updated_at
	from public.todos
	order by position asc;

-- Function to reorder todos in a single call (optional optimization)
create or replace function public.reorder_todos(ids uuid[])
returns void language plpgsql as $$
declare
	i int;
begin
	i := 0;
	foreach id in array ids loop
		update public.todos set position = i where public.todos.id = id;
		i := i + 1;
	end loop;
end;$$;

-- Security: enable RLS and simple policies (adjust to auth model as needed)
alter table public.todos enable row level security;

-- Simple open policies (lock down for real apps)
create policy "Select all" on public.todos for select using (true);
create policy "Insert all" on public.todos for insert with check (true);
create policy "Update all" on public.todos for update using (true);
create policy "Delete all" on public.todos for delete using (true);
```

### Optional: Use the reorder function
If you want to use the SQL function instead of multiple row upserts, you could adapt the `reorderTodos` action to call:
```ts
await supabase.rpc('reorder_todos', { ids: newOrderIds });
```

### Deployment Notes
All persistence now in Supabase Postgres. No filesystem writes needed.

### Extending
Ideas:
* Add filters (All / Active / Completed) with query params.
* Add editing & optimistic undo.
* Add user auth and per-user todos (add a `user_id uuid` column, policies referencing `auth.uid()`).
* Add soft delete with a `deleted_at` column.

### License
MIT
