import asyncio
import json
from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse
from services import orchestrator

router = APIRouter(prefix="/stream", tags=["stream"])


@router.get("/{session_id}")
async def stream_session(session_id: str):
    session = orchestrator.sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    async def event_generator():
        # If debate already completed, replay all turns
        if session["status"] == "completed":
            for turn in session["turns"]:
                p = next(p for p in session["participants"] if p["id"] == turn["participant_id"])
                yield {"data": json.dumps({
                    "type": "turn_start",
                    "turn_id": turn["id"],
                    "participant_id": turn["participant_id"],
                    "participant_name": p["name"],
                    "position": p["position"],
                    "round": turn["round_type"],
                })}
                yield {"data": json.dumps({"type": "token", "turn_id": turn["id"], "token": turn["content"]})}
                yield {"data": json.dumps({"type": "turn_end", "turn_id": turn["id"]})}
            yield {"data": json.dumps({"type": "debate_end"})}
            return

        # Live stream from queue
        q = orchestrator.stream_queues.get(session_id)
        if not q:
            # Session not started yet — wait briefly
            for _ in range(20):
                await asyncio.sleep(0.5)
                q = orchestrator.stream_queues.get(session_id)
                if q:
                    break
            if not q:
                yield {"data": json.dumps({"type": "error", "message": "Session not started"})}
                return

        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=60.0)
                yield {"data": json.dumps(event)}
                if event.get("type") == "done":
                    break
            except asyncio.TimeoutError:
                yield {"data": json.dumps({"type": "ping"})}

    return EventSourceResponse(event_generator())
