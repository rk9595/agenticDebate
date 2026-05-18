import asyncio
import uuid
import secrets
from fastapi import APIRouter, HTTPException
from models.session import SessionCreate
from services import orchestrator, crypto, db

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("")
async def create_session(body: SessionCreate):
    if len(body.participants) < 2:
        raise HTTPException(400, "At least 2 participants required")

    session_id = str(uuid.uuid4())
    share_token = secrets.token_urlsafe(12)

    await db.create_session(session_id, body.topic, body.rules.model_dump(), share_token)

    participants = []
    for p in body.participants:
        cfg = p.agent_config.model_dump()
        raw_key = cfg.pop("api_key")
        cfg["api_key_enc"] = crypto.encrypt(raw_key)
        participants.append({
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "name": p.name,
            "position": p.position.value,
            "agent_config": cfg,
        })
    await db.create_participants(participants)

    return {"id": session_id, "share_token": share_token}


@router.get("/{session_id}")
async def get_session(session_id: str):
    session = await db.get_full_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return _safe_session(session)


@router.post("/{session_id}/start")
async def start_session(session_id: str):
    session = await db.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session["status"] != "pending":
        raise HTTPException(400, f"Session already {session['status']}")

    orchestrator.stream_queues[session_id] = asyncio.Queue()
    asyncio.create_task(orchestrator.run(session_id))
    return {"status": "started"}


@router.get("/replay/{share_token}")
async def get_replay(share_token: str):
    session = await db.get_full_session_by_share_token(share_token)
    if not session:
        raise HTTPException(404, "Debate not found")
    return _safe_session(session)


def _safe_session(session: dict) -> dict:
    safe = dict(session)
    safe["participants"] = [
        {k: v for k, v in p.items() if k != "agent_config"}
        | {"agent_config": {k: v for k, v in p["agent_config"].items() if k != "api_key_enc"}}
        for p in session["participants"]
    ]
    return safe
