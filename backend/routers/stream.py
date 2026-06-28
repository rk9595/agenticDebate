import asyncio
import json
from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse
from services import orchestrator, db

router = APIRouter(prefix="/stream", tags=["stream"])

_NIGHT_CHANNEL = {"night_mafia": "mafia", "night_doctor": "doctor", "night_detective": "detective"}


async def _replay_mafia(session_id: str, session: dict):
    turns = await db.get_turns(session_id)
    participants = await db.get_participants(session_id)
    events = await db.get_mafia_events(session_id)
    p_by_id = {p["id"]: p for p in participants}

    yield {"data": json.dumps({
        "type": "game_start",
        "players": [{"id": p["id"], "name": p["name"]} for p in participants],
    })}
    for e in events:
        if e["event_type"] == "role_assignment":
            p = p_by_id.get(e["actor_id"], {})
            yield {"data": json.dumps({
                "type": "role_assignment",
                "participant_id": e["actor_id"],
                "name": p.get("name", ""),
                "role": e["data"].get("role"),
            })}

    max_day = max([t["round_num"] for t in turns] + [e["day_num"] for e in events] + [0])

    def emit_turn(t):
        p = p_by_id.get(t["participant_id"], {})
        channel = _NIGHT_CHANNEL.get(t["round_type"], "public")
        ts = {
            "type": "turn_start",
            "turn_id": t["id"],
            "participant_id": t["participant_id"],
            "participant_name": p.get("name", ""),
            "position": p.get("role", "player"),
            "round": t["round_type"],
            "channel": channel,
            "day_num": t["round_num"],
        }
        return [
            {"data": json.dumps(ts)},
            {"data": json.dumps({"type": "token", "turn_id": t["id"], "token": t["content"]})},
            {"data": json.dumps({"type": "turn_end", "turn_id": t["id"]})},
        ]

    for day in range(1, max_day + 1):
        day_turns = [t for t in turns if t["round_num"] == day]
        day_events = [e for e in events if e["day_num"] == day]

        yield {"data": json.dumps({"type": "phase_start", "phase": "night", "day_num": day})}
        for t in [t for t in day_turns if t["round_type"].startswith("night")]:
            for ev in emit_turn(t):
                yield ev
        for e in [e for e in day_events if e["event_type"] == "night_action"]:
            tgt = p_by_id.get(e["target_id"], {})
            yield {"data": json.dumps({
                "type": "night_action",
                "action": e["data"].get("action"),
                "target_id": e["target_id"],
                "target_name": tgt.get("name", ""),
                "result": e["data"].get("result"),
            })}
        for e in [e for e in day_events if e["event_type"] == "death"]:
            if e.get("target_id"):
                tgt = p_by_id.get(e["target_id"], {})
                yield {"data": json.dumps({
                    "type": "death", "participant_id": e["target_id"],
                    "name": tgt.get("name", ""), "role": e["data"].get("role"), "cause": "mafia",
                })}
            else:
                yield {"data": json.dumps({"type": "dawn", "killed": None, "saved": e["data"].get("saved", False), "day_num": day})}

        day_discussion = [t for t in day_turns if t["round_type"] == "day"]
        if day_discussion:
            yield {"data": json.dumps({"type": "phase_start", "phase": "day", "day_num": day})}
            for t in day_discussion:
                for ev in emit_turn(t):
                    yield ev

        vote_turns = [t for t in day_turns if t["round_type"] == "vote"]
        if vote_turns:
            yield {"data": json.dumps({"type": "phase_start", "phase": "vote", "day_num": day})}
            for t in vote_turns:
                for ev in emit_turn(t):
                    yield ev
            for e in [e for e in day_events if e["event_type"] == "vote_cast"]:
                voter = p_by_id.get(e["actor_id"], {})
                yield {"data": json.dumps({
                    "type": "vote_cast", "voter_id": e["actor_id"], "voter_name": voter.get("name", ""),
                    "target_id": e.get("target_id"), "target_name": e["data"].get("target_name"),
                })}
            for e in [e for e in day_events if e["event_type"] == "elimination"]:
                if e.get("target_id"):
                    tgt = p_by_id.get(e["target_id"], {})
                    yield {"data": json.dumps({
                        "type": "elimination", "participant_id": e["target_id"],
                        "name": tgt.get("name", ""), "role": e["data"].get("role"), "cause": "lynch",
                    })}
                else:
                    yield {"data": json.dumps({"type": "elimination", "participant_id": None, "cause": "tie"})}

    for e in events:
        if e["event_type"] == "game_end":
            yield {"data": json.dumps({"type": "game_end", "winner": e["data"].get("winner")})}
    yield {"data": json.dumps({"type": "debate_end"})}


@router.get("/{session_id}")
async def stream_session(session_id: str):
    session = await db.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    async def event_generator():
        if session["status"] == "completed" and session.get("session_type") == "mafia":
            async for ev in _replay_mafia(session_id, session):
                yield ev
            return

        if session["status"] == "completed":
            # Replay from DB
            turns = await db.get_turns(session_id)
            participants = await db.get_participants(session_id)
            judgments = await db.get_judgments(session_id)
            p_by_id = {p["id"]: p for p in participants}
            # judgments keyed by turn_id (per-turn judgments); final verdict has turn_id=None
            j_by_turn: dict[str, dict] = {}
            final_verdict = None
            for j in judgments:
                if j.get("turn_id"):
                    j_by_turn[j["turn_id"]] = j
                else:
                    final_verdict = j

            last_round: tuple[str, int] | None = None
            for turn in turns:
                p = p_by_id.get(turn["participant_id"], {})
                round_key = (turn["round_type"], turn["round_num"])
                if round_key != last_round:
                    yield {"data": json.dumps({
                        "type": "round_start",
                        "round": turn["round_type"],
                        "round_num": turn["round_num"],
                    })}
                    last_round = round_key
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
                j = j_by_turn.get(turn["id"])
                if j:
                    jid = j["id"]
                    yield {"data": json.dumps({
                        "type": "judgment_start",
                        "judgment_id": jid,
                        "turn_id": turn["id"],
                        "participant_id": turn["participant_id"],
                        "participant_name": p.get("name", ""),
                    })}
                    yield {"data": json.dumps({"type": "judgment_token", "judgment_id": jid, "token": j["reasoning"]})}
                    yield {"data": json.dumps({
                        "type": "judgment_end",
                        "judgment_id": jid,
                        "turn_id": turn["id"],
                        "score": j.get("score"),
                    })}
            if final_verdict:
                jid = final_verdict["id"]
                yield {"data": json.dumps({"type": "verdict_start", "judgment_id": jid})}
                yield {"data": json.dumps({"type": "verdict_token", "judgment_id": jid, "token": final_verdict["reasoning"]})}
                yield {"data": json.dumps({
                    "type": "verdict_end",
                    "judgment_id": jid,
                    "winner": session.get("winner"),
                    "reasoning": final_verdict["reasoning"],
                })}
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
