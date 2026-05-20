import asyncio
import os
from datetime import datetime, timezone
from supabase import create_client, Client


def _client() -> Client:
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])


async def _run(fn):
    return await asyncio.to_thread(fn)


# ── Sessions ─────────────────────────────────────────────────────────────────

async def create_session(session_id: str, topic: str, rules: dict, share_token: str, session_type: str = "debate", judge_config: dict | None = None) -> dict:
    payload: dict = {
        "id": session_id,
        "topic": topic,
        "rules": rules,
        "share_token": share_token,
        "session_type": session_type,
        "status": "pending",
        "current_round_num": 0,
    }
    if judge_config is not None:
        payload["judge_config"] = judge_config
    def _():
        return _client().table("debate_sessions").insert(payload).execute()
    r = await _run(_)
    return r.data[0]


async def update_session_winner(session_id: str, winner: str, reasoning: str) -> None:
    payload = {
        "winner": winner,
        "winner_reasoning": reasoning,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    def _():
        return _client().table("debate_sessions").update(payload).eq("id", session_id).execute()
    await _run(_)


async def update_session_status(session_id: str, status: str, current_round_num: int | None = None) -> None:
    payload: dict = {
        "status": status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if current_round_num is not None:
        payload["current_round_num"] = current_round_num

    def _():
        return _client().table("debate_sessions").update(payload).eq("id", session_id).execute()
    await _run(_)


async def get_session(session_id: str) -> dict | None:
    def _():
        return _client().table("debate_sessions").select("*").eq("id", session_id).maybe_single().execute()
    r = await _run(_)
    if not r or not r.data:
        return None
    return r.data


async def get_session_by_share_token(token: str) -> dict | None:
    def _():
        return _client().table("debate_sessions").select("*").eq("share_token", token).maybe_single().execute()
    r = await _run(_)
    if not r or not r.data:
        return None
    return r.data


# ── Participants ──────────────────────────────────────────────────────────────

async def create_participants(participants: list[dict]) -> list[dict]:
    def _():
        return _client().table("debate_participants").insert(participants).execute()
    r = await _run(_)
    return r.data


async def get_participants(session_id: str) -> list[dict]:
    def _():
        return _client().table("debate_participants").select("*").eq("session_id", session_id).execute()
    r = await _run(_)
    return r.data or []


# ── Turns ─────────────────────────────────────────────────────────────────────

async def save_turn(turn: dict) -> None:
    def _():
        return _client().table("debate_turns").insert({
            "id": turn["id"],
            "session_id": turn["session_id"],
            "participant_id": turn["participant_id"],
            "round_type": turn["round_type"],
            "round_num": turn["round_num"],
            "content": turn["content"],
            "status": turn["status"],
            "started_at": turn["started_at"],
            "completed_at": turn.get("completed_at"),
        }).execute()
    await _run(_)


async def get_turns(session_id: str) -> list[dict]:
    def _():
        return (
            _client()
            .table("debate_turns")
            .select("*")
            .eq("session_id", session_id)
            .order("round_num")
            .order("started_at")
            .execute()
        )
    r = await _run(_)
    return r.data or []


# ── Judgments ────────────────────────────────────────────────────────────────

async def save_judgment(judgment: dict) -> None:
    def _():
        return _client().table("debate_judgments").insert({
            "id": judgment["id"],
            "session_id": judgment["session_id"],
            "turn_id": judgment.get("turn_id"),
            "participant_id": judgment.get("participant_id"),
            "round_type": judgment.get("round_type"),
            "round_num": judgment.get("round_num"),
            "score": judgment.get("score"),
            "reasoning": judgment["reasoning"],
            "status": judgment["status"],
        }).execute()
    await _run(_)


async def get_judgments(session_id: str) -> list[dict]:
    def _():
        return (
            _client()
            .table("debate_judgments")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at")
            .execute()
        )
    r = await _run(_)
    return r.data or []


# ── Composite: full session with participants + turns ─────────────────────────

async def get_full_session(session_id: str) -> dict | None:
    session = await get_session(session_id)
    if not session:
        return None
    session["participants"] = await get_participants(session_id)
    session["turns"] = await get_turns(session_id)
    session["judgments"] = await get_judgments(session_id)
    return session


async def get_full_session_by_share_token(token: str) -> dict | None:
    session = await get_session_by_share_token(token)
    if not session:
        return None
    session["participants"] = await get_participants(session["id"])
    session["turns"] = await get_turns(session["id"])
    session["judgments"] = await get_judgments(session["id"])
    return session
