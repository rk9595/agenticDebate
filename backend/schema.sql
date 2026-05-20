-- Run this in the Supabase SQL editor once to set up the schema.

create table if not exists debate_sessions (
  id                uuid primary key default gen_random_uuid(),
  topic             text not null,
  status            text not null default 'pending', -- pending | running | completed | error
  session_type      text not null default 'debate',  -- debate | meeting
  rules             jsonb not null default '{"max_words": 300, "rounds": 3, "public": true}',
  share_token       text unique not null,
  current_round_num int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Migration for existing databases: run once
-- alter table debate_sessions add column if not exists session_type text not null default 'debate';

create table if not exists debate_participants (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references debate_sessions(id) on delete cascade,
  name        text not null,
  position    text not null,  -- for | against | neutral
  agent_config jsonb not null -- { provider, model_id, api_key_enc, system_prompt, base_url }
);

create table if not exists debate_turns (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references debate_sessions(id) on delete cascade,
  participant_id uuid not null references debate_participants(id),
  round_type     text not null,  -- opening | rebuttal | closing
  round_num      int  not null,
  content        text not null default '',
  status         text not null default 'completed',
  started_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create index if not exists debate_sessions_share_token_idx on debate_sessions(share_token);
create index if not exists debate_participants_session_id_idx on debate_participants(session_id);
create index if not exists debate_turns_session_id_idx on debate_turns(session_id, round_num);

-- Judge agent support
-- Migration for existing databases: run these once
-- alter table debate_sessions add column if not exists judge_config jsonb;
-- alter table debate_sessions add column if not exists winner text;
-- alter table debate_sessions add column if not exists winner_reasoning text;

create table if not exists debate_judgments (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references debate_sessions(id) on delete cascade,
  turn_id        uuid references debate_turns(id),
  participant_id uuid references debate_participants(id),
  round_type     text,
  round_num      int,
  score          int,   -- 1-10, null for final verdict
  reasoning      text not null default '',
  status         text not null default 'completed',
  created_at     timestamptz not null default now()
);

create index if not exists debate_judgments_session_id_idx on debate_judgments(session_id);
