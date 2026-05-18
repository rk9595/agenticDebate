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

- `backend/.env` — `ENCRYPTION_KEY` (AES-256 base64 key, already generated)
- `frontend/.env.local` — `NEXT_PUBLIC_API_URL=http://localhost:8000`

## Architecture decisions

- In-memory session store for MVP (no DB needed to start)
- SSE streaming via `sse-starlette` + `asyncio.Queue` per session
- API keys encrypted with AES-256-GCM before storing in memory
- Orchestrator runs as an `asyncio.create_task` — non-blocking
- Rounds: Opening → Rebuttal → Closing (Closing order is reversed: Against first)

## Adding a new LLM provider

1. Add to `Provider` enum in `backend/models/session.py`
2. Add streaming impl in `backend/services/llm_client.py`
3. Add to `MODEL_OPTIONS` in `frontend/app/page.tsx`
