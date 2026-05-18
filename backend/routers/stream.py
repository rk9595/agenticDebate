import asyncio
import json
from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse
from services import orchestrator, db

router = APIRouter(prefix="/stream", tags=["stream"])


@router.get("/{session_id}")
async def stream_session(session_id: str):
    session = await db.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    async def event_generator():
        if session["status"] == "completed":
            # Replay from DB
            turns = await db.get_turns(session_id)
            participants = await db.get_participants(session_id)
            p_by_id = {p["id"]: p for p in participants}

            for turn in turns:
                p = p_by_id.get(turn["participant_id"], {})
                yield {"data": json.dumps({
                    "type": "turn_start",
                    "turn_id": turn["id"],
                    "participant_id": turn["participant_id"],
                    "participant_name": p.get("name", ""),
                    "position": p.get("position", ""),
                    "round": turn["round_type"],
                    "round_num": turn["round_num"],
                })}
                yield {"data": json.dumps({"type": "token", "turn_id": turn["id"], "token": turn["content"]})}
                yield {"data": json.dumps({"type": "turn_end", "turn_id": turn["id"]})}
            yield {"data": json.dumps({"type": "debate_end"})}
            return

        # Live stream — wait for queue to appear
        q = orchestrator.stream_queues.get(session_id)
        if not q:
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
