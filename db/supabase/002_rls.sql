-- Supabase-only: row-level security.
-- Apply AFTER db/migrations/001_init.sql when DATABASE_URL points at Supabase.
-- The simulation worker connects with the service role (bypasses RLS) and is
-- the only writer. Browsers using the anon key may only read public data.
-- Viewers never write authoritative state directly: every write goes through
-- the worker API, which validates it.

do $$
declare t text;
begin
  foreach t in array array[
    'users','characters','character_state','personality_traits','habits','memories','world_locations',
    'world_objects','inventory','activities','simulation_events','simulation_snapshots','ai_decisions',
    'gifts','gift_interactions','chat_messages','chat_reactions','chat_reports','user_blocks',
    'community_goals','community_contributions','polls','poll_options','poll_votes','diary_entries',
    'highlights','user_contribution_history','audit_log','api_usage','worker_errors'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- public, read-only views of the shared life
create policy "public read" on characters for select using (true);
create policy "public read" on character_state for select using (true);
create policy "public read" on personality_traits for select using (true);
create policy "public read" on habits for select using (true);
create policy "public read" on memories for select using (true);
create policy "public read" on world_locations for select using (true);
create policy "public read" on world_objects for select using (removed_at is null);
create policy "public read" on simulation_events for select using (true);
create policy "public read" on diary_entries for select using (true);
create policy "public read" on highlights for select using (status <> 'rejected');
create policy "public read" on community_goals for select using (true);
create policy "public read" on polls for select using (true);
create policy "public read" on poll_options for select using (true);
create policy "public read" on chat_messages for select using (hidden = false);

-- private data: no anon/authenticated policies at all
-- (simulation_snapshots, ai_decisions, audit_log, api_usage, worker_errors,
--  chat_reports, user_blocks, poll_votes, community_contributions, gifts,
--  gift_interactions, inventory, activities, user_contribution_history, users)
