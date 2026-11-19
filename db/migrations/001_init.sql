-- CALMLING schema v1
-- Portable PostgreSQL (runs on Supabase Postgres, managed Postgres and embedded PGlite).
-- The simulation service is the only writer of character and world state.

create table if not exists users (
  id text primary key,
  username text not null unique,
  display_name text,
  role text not null default 'viewer' check (role in ('viewer', 'admin')),
  muted_until timestamptz,
  banned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists characters (
  id text primary key,
  name text not null,
  seed bigint not null,
  created_at timestamptz not null default now()
);

create table if not exists character_state (
  character_id text primary key references characters(id),
  minute double precision not null,
  day integer not null,
  location text not null,
  x double precision not null,
  mood text not null,
  awake boolean not null,
  needs jsonb not null,
  traits jsonb not null,
  activity jsonb,
  goal text,
  held_object_id text,
  updated_at timestamptz not null default now()
);

create table if not exists personality_traits (
  id bigserial primary key,
  character_id text not null references characters(id),
  day integer not null,
  minute double precision not null,
  traits jsonb not null,
  recorded_at timestamptz not null default now(),
  unique (character_id, day)
);

create table if not exists habits (
  id text primary key,
  character_id text not null references characters(id),
  key text not null unique,
  kind text not null,
  label text not null,
  action text not null,
  phase text,
  location text,
  status text not null,
  strength double precision not null,
  formed_day integer,
  explanation text not null,
  evidence jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists habits_status_idx on habits (status, strength desc);

create table if not exists memories (
  id text primary key,
  character_id text not null references characters(id),
  type text not null check (type in ('episodic', 'semantic', 'preference', 'social', 'habit')),
  minute double precision not null,
  day integer not null,
  summary text not null,
  importance double precision not null,
  related_object_ids jsonb not null default '[]',
  related_event_ids jsonb not null default '[]',
  location text,
  emotion jsonb not null,
  consolidated boolean not null default false,
  key text,
  recall_count integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists memories_day_idx on memories (day desc, minute desc);
create index if not exists memories_type_idx on memories (type, importance desc);

create table if not exists world_locations (
  id text primary key,
  name text not null,
  x0 double precision not null,
  x1 double precision not null,
  indoor boolean not null,
  description text not null
);

create table if not exists world_objects (
  id text primary key,
  kind text not null,
  name text not null,
  tags jsonb not null,
  location text not null,
  x double precision not null,
  held_by text,
  state jsonb not null,
  discovered boolean not null,
  origin jsonb not null,
  interactions integer not null default 0,
  affinity double precision not null default 0,
  created_minute double precision not null,
  created_day integer not null,
  removed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists world_objects_location_idx on world_objects (location) where removed_at is null;

create table if not exists inventory (
  character_id text not null references characters(id),
  object_id text not null,
  acquired_minute double precision not null,
  primary key (character_id, object_id)
);

create table if not exists activities (
  id text primary key,
  character_id text not null references characters(id),
  action text not null,
  goal text,
  target_id text,
  location text not null,
  started_minute double precision not null,
  ends_minute double precision not null,
  decision_id text,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists activities_started_idx on activities (started_minute desc);

create table if not exists simulation_events (
  id text primary key,
  seq bigint not null unique,
  minute double precision not null,
  day integer not null,
  type text not null,
  summary text not null,
  location text,
  object_ids jsonb not null default '[]',
  action text,
  data jsonb not null default '{}',
  importance double precision not null,
  created_at timestamptz not null default now()
);
create index if not exists events_day_idx on simulation_events (day, seq);
create index if not exists events_type_idx on simulation_events (type, seq desc);

create table if not exists simulation_snapshots (
  id text primary key,
  tick bigint not null,
  seq bigint not null,
  minute double precision not null,
  state jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists ai_decisions (
  id text primary key,
  minute double precision not null,
  day integer not null,
  source text not null,
  model text,
  goal text not null,
  action text not null,
  target_id text,
  reason text not null,
  valid boolean not null,
  rejection_reason text,
  candidates jsonb not null,
  thought text,
  created_at timestamptz not null default now()
);
create index if not exists ai_decisions_minute_idx on ai_decisions (minute desc);

create table if not exists gifts (
  id text primary key,
  kind text not null,
  sender_user_id text not null references users(id),
  sender_name text not null,
  message text,
  location text not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'rejected')),
  object_id text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  delivered_day integer
);
create index if not exists gifts_status_idx on gifts (status, created_at);
create index if not exists gifts_sender_idx on gifts (sender_user_id, created_at desc);

create table if not exists gift_interactions (
  id bigserial primary key,
  gift_id text not null references gifts(id),
  object_id text not null,
  event_id text not null unique,
  action text,
  summary text not null,
  minute double precision not null,
  day integer not null,
  created_at timestamptz not null default now()
);
create index if not exists gift_interactions_gift_idx on gift_interactions (gift_id);

create table if not exists chat_messages (
  id text primary key,
  user_id text not null references users(id),
  username text not null,
  text text not null,
  flags jsonb not null default '[]',
  hidden boolean not null default false,
  hidden_reason text,
  created_at timestamptz not null default now()
);
create index if not exists chat_created_idx on chat_messages (created_at desc);

create table if not exists chat_reactions (
  message_id text not null references chat_messages(id),
  user_id text not null references users(id),
  emoji text not null,
  primary key (message_id, user_id, emoji)
);

create table if not exists chat_reports (
  id bigserial primary key,
  message_id text not null references chat_messages(id),
  reporter_id text not null references users(id),
  reason text,
  created_at timestamptz not null default now(),
  unique (message_id, reporter_id)
);

create table if not exists user_blocks (
  user_id text not null references users(id),
  blocked_user_id text not null references users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_user_id)
);

create table if not exists community_goals (
  id text primary key,
  title text not null,
  description text not null,
  target integer not null check (target > 0),
  progress integer not null default 0,
  contributor_count integer not null default 0,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  reward_kind text not null,
  reward_label text not null,
  per_user_daily_limit integer not null default 10,
  completion_event_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists community_contributions (
  id bigserial primary key,
  goal_id text not null references community_goals(id),
  user_id text not null references users(id),
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists contributions_user_idx on community_contributions (goal_id, user_id, created_at);

create table if not exists polls (
  id text primary key,
  question text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  closes_at timestamptz not null,
  winning_option_id text,
  outcome_event_id text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists poll_options (
  id text primary key,
  poll_id text not null references polls(id),
  label text not null,
  kind text not null,
  sort integer not null default 0
);

create table if not exists poll_votes (
  poll_id text not null references polls(id),
  user_id text not null references users(id),
  option_id text not null references poll_options(id),
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create table if not exists diary_entries (
  id text primary key,
  day integer not null unique,
  title text not null,
  body text not null,
  facts jsonb not null,
  generator text not null,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists highlights (
  id text primary key,
  event_id text not null,
  minute double precision not null,
  day integer not null,
  title text not null,
  description text not null,
  score double precision not null,
  scores jsonb not null,
  replay jsonb not null,
  status text not null default 'new' check (status in ('new', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create index if not exists highlights_score_idx on highlights (day desc, score desc);

create table if not exists user_contribution_history (
  id bigserial primary key,
  user_id text not null references users(id),
  kind text not null check (kind in ('gift', 'vote', 'contribution')),
  ref_id text not null,
  summary text not null,
  object_id text,
  day integer,
  created_at timestamptz not null default now()
);
create index if not exists uch_user_idx on user_contribution_history (user_id, created_at desc);

create table if not exists audit_log (
  id bigserial primary key,
  actor text not null,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists api_usage (
  id bigserial primary key,
  provider text not null,
  model text not null,
  purpose text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd double precision not null default 0,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists api_usage_created_idx on api_usage (created_at desc);

create table if not exists worker_errors (
  id bigserial primary key,
  scope text not null,
  message text not null,
  stack text,
  created_at timestamptz not null default now()
);
