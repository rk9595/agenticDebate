import asyncio
import json as json_lib
import uuid
import secrets

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from models.session import SessionCreate, Provider
from services import orchestrator, crypto, db
from services.llm_client import validate_webhook_url

router = APIRouter(prefix="/sessions", tags=["sessions"])


class KeyHandleRequest(BaseModel):
    api_key: str


@router.post("/key-handles")
async def create_key_handle(body: KeyHandleRequest):
    if not body.api_key or not body.api_key.strip():
        raise HTTPException(400, "api_key is required")
    encrypted = crypto.encrypt(body.api_key.strip())
    handle_id = await db.create_key_handle(encrypted)
    return {"key_handle_id": handle_id}


class WebhookTestRequest(BaseModel):
    url: str
    secret: str = ""


@router.post("/webhook-test")
async def webhook_test(body: WebhookTestRequest):
    try:
        validate_webhook_url(body.url)
    except ValueError as e:
        return {"ok": False, "error": str(e)}

    payload = {
        "messages": [
            {"role": "system", "content": "You are a test debater. Reply briefly."},
            {"role": "user", "content": "Topic: testing. Give a one-sentence opening."},
        ],
        "max_tokens": 100,
    }
    headers = {"Content-Type": "application/json"}
    if body.secret:
        headers["X-AgenticDebate-Secret"] = body.secret

    timeout = httpx.Timeout(30.0, connect=5.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", body.url, json=payload, headers=headers) as response:
                if response.status_code >= 400:
                    snippet = (await response.aread())[:160].decode("utf-8", errors="replace")
                    return {"ok": False, "status": response.status_code, "error": f"HTTP {response.status_code}: {snippet}"}

                content_type = response.headers.get("content-type", "")

                if "text/event-stream" in content_type:
                    tokens: list[str] = []
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            event = json_lib.loads(data)
                        except json_lib.JSONDecodeError:
                            continue
                        tok = event.get("token")
                        if tok:
                            tokens.append(tok)
                            if sum(len(t) for t in tokens) > 200:
                                break
                    sample = "".join(tokens)
                    return {
                        "ok": bool(sample.strip()),
                        "mode": "streaming",
                        "status": response.status_code,
                        "sample": sample,
                        "error": "" if sample.strip() else "No tokens received before stream ended",
                    }

                body_bytes = await response.aread()
                try:
                    data = json_lib.loads(body_bytes)
                except json_lib.JSONDecodeError:
                    return {"ok": False, "status": response.status_code, "error": f"Non-JSON response: {body_bytes[:120]!r}"}
                content = data.get("content") or ""
                return {
                    "ok": bool(content.strip()),
                    "mode": "json",
                    "status": response.status_code,
                    "sample": content[:200],
                    "error": "" if content.strip() else "Response had no 'content' field",
                }
    except httpx.TimeoutException:
        return {"ok": False, "error": "Timeout (30s)"}
    except httpx.ConnectError as e:
        return {"ok": False, "error": f"Connection failed: {e}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("")
async def create_session(body: SessionCreate):
    if len(body.participants) < 2:
        raise HTTPException(400, "At least 2 participants required")

    for p in body.participants:
        if p.agent_config.provider == Provider.webhook:
            try:
                validate_webhook_url(p.agent_config.base_url or "")
            except ValueError as e:
                raise HTTPException(400, f"{p.name}: {e}")
    if body.judge_config and body.judge_config.provider == Provider.webhook:
        try:
            validate_webhook_url(body.judge_config.base_url or "")
        except ValueError as e:
            raise HTTPException(400, f"Judge: {e}")

    session_id = str(uuid.uuid4())
    share_token = secrets.token_urlsafe(12)

    async def _resolve_key_enc(cfg: dict) -> str:
        handle_id = cfg.pop("key_handle_id", None)
        raw_key = cfg.pop("api_key", "") or ""
        if handle_id:
            enc = await db.get_key_handle(handle_id)
            if not enc:
                raise HTTPException(400, "Invalid key_handle_id")
            return enc
        return crypto.encrypt(raw_key)

    judge_config = None
    if body.judge_config:
        jcfg = body.judge_config.model_dump()
        jcfg["api_key_enc"] = await _resolve_key_enc(jcfg)
        judge_config = jcfg

    await db.create_session(session_id, body.topic, body.rules.model_dump(), share_token, body.session_type.value, judge_config)

    participants = []
    for p in body.participants:
        cfg = p.agent_config.model_dump()
        cfg["api_key_enc"] = await _resolve_key_enc(cfg)
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
    session_type = session.get("session_type", "debate")
    if session_type == "meeting":
        asyncio.create_task(orchestrator.run_meeting(session_id))
    else:
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
