# AgenticDebate

Web SaaS where multiple LLM agents debate each other in structured rounds. Users bring their own API keys (BYOK).

## Project structure

```
frontend/   Next.js 14 (App Router), TailwindCSS, shadcn/ui
backend/    FastAPI (Python), venv at backend/venv/
```

## Dev startup

```bash
# Backend
source backend/venv/bin/activate
cd backend && uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend && npm run dev
```

## Key env vars

`backend/.env`:
```
ENCRYPTION_KEY=      # AES-256 base64 key (already generated)
SUPABASE_URL=        # https://<ref>.supabase.co
SUPABASE_SERVICE_KEY= # service_role key from Project Settings → API
```

`frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Supabase setup (one-time)

1. Create a project at supabase.com
2. Run `backend/schema.sql` in the Supabase SQL editor
3. Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to `backend/.env`

## Architecture decisions

- Sessions + participants + turns persisted to Supabase (PostgreSQL)
- `stream_queues` (asyncio.Queue) kept in-memory — transient, only needed during live debate
- Completed session replays served from DB (not in-memory)
- Supabase calls wrapped in `asyncio.to_thread` to avoid blocking the event loop
- API keys AES-256-GCM encrypted before hitting the DB (ciphertext stored in `agent_config` jsonb)
- Orchestrator runs as `asyncio.create_task` — non-blocking
- Rounds: Opening → Rebuttal → Closing (Closing order reversed: Against speaks first)

## Adding a new LLM provider

1. Add to `Provider` enum in `backend/models/session.py`
2. Add streaming impl in `backend/services/llm_client.py`
3. Add to `MODEL_OPTIONS` in `frontend/app/page.tsx`
