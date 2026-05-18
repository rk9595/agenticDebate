import asyncio
import uuid
import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from models.session import SessionCreate
from services import orchestrator, crypto

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("")
async def create_session(body: SessionCreate):
    if len(body.participants) < 2:
        raise HTTPException(400, "At least 2 participants required")

    session_id = str(uuid.uuid4())
    share_token = secrets.token_urlsafe(12)

    participants = []
    for p in body.participants:
        cfg = p.agent_config.model_dump()
        raw_key = cfg.pop("api_key")
        cfg["api_key_enc"] = crypto.encrypt(raw_key)
        participants.append({
            "id": str(uuid.uuid4()),
            "name": p.name,
            "position": p.position.value,
            "agent_config": cfg,
        })

    session = {
        "id": session_id,
        "topic": body.topic,
        "status": "pending",
        "rules": body.rules.model_dump(),
        "share_token": share_token,
        "participants": participants,
        "turns": [],
        "current_round_num": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    orchestrator.sessions[session_id] = session

    return {"id": session_id, "share_token": share_token}


@router.get("/{session_id}")
async def get_session(session_id: str):
    session = orchestrator.sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return _safe_session(session)


@router.post("/{session_id}/start")
async def start_session(session_id: str):
    session = orchestrator.sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session["status"] not in ("pending",):
        raise HTTPException(400, f"Session already {session['status']}")

    orchestrator.stream_queues[session_id] = asyncio.Queue()
    asyncio.create_task(orchestrator.run(session_id))
    return {"status": "started"}


@router.get("/replay/{share_token}")
async def get_replay(share_token: str):
    session = next(
        (s for s in orchestrator.sessions.values() if s["share_token"] == share_token),
        None,
    )
    if not session:
        raise HTTPException(404, "Debate not found")
    return _safe_session(session)


def _safe_session(session: dict) -> dict:
    # Never return encrypted keys
    safe = dict(session)
    safe["participants"] = [
        {k: v for k, v in p.items() if k != "agent_config"}
        | {"agent_config": {k: v for k, v in p["agent_config"].items() if k != "api_key_enc"}}
        for p in session["participants"]
    ]
    return safe
