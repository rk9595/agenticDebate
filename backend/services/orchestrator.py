import asyncio
import json
import uuid
from datetime import datetime, timezone
from models.session import RoundType, Position
from services import llm_client, crypto

# In-memory store for MVP (replace with Supabase in production)
sessions: dict = {}
stream_queues: dict[str, asyncio.Queue] = {}

ROUND_SEQUENCE = [RoundType.opening, RoundType.rebuttal, RoundType.closing]

ROUND_INSTRUCTIONS = {
    RoundType.opening: "Give your opening statement. Clearly state your position and your strongest arguments.",
    RoundType.rebuttal: "Rebut your opponent's arguments. Address their specific points and reinforce your own position.",
    RoundType.closing: "Give your closing statement. Summarize your strongest points and explain why your position prevails.",
}

# Closing goes Against → For (reverse) for last-word effect
CLOSING_ORDER_REVERSED = True


def _build_context(session: dict, round_type: RoundType, participant: dict, history: list[dict]) -> list[dict]:
    system_prompt = participant["agent_config"].get("system_prompt") or (
        f"You are a skilled debater arguing the {participant['position']} side."
    )

    history_text = ""
    for turn in history:
        p = next(p for p in session["participants"] if p["id"] == turn["participant_id"])
        history_text += f"\n\n[{p['name']} — {p['position'].upper()}]\n{turn['content']}"

    user_content = (
        f"Topic: \"{session['topic']}\"\n"
        f"Your position: {participant['position'].upper()}\n"
        f"Round: {round_type.value} ({session['current_round_num']} of {session['rules']['rounds']})\n"
    )
    if history_text:
        user_content += f"\nDebate so far:{history_text}\n"
    user_content += f"\n{ROUND_INSTRUCTIONS[round_type]} Max {session['rules']['max_words']} words."

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]


async def _publish(session_id: str, event: dict):
    q = stream_queues.get(session_id)
    if q:
        await q.put(event)


async def run(session_id: str):
    session = sessions[session_id]
    session["status"] = "running"
    history: list[dict] = []

    try:
        for round_num, round_type in enumerate(ROUND_SEQUENCE, start=1):
            session["current_round_num"] = round_num
            participants = session["participants"]

            # Closing round: reverse order
            if round_type == RoundType.closing and CLOSING_ORDER_REVERSED:
                ordered = list(reversed(participants))
            else:
                ordered = participants

            await _publish(session_id, {"type": "round_start", "round": round_type.value, "round_num": round_num})

            for participant in ordered:
                turn_id = str(uuid.uuid4())
                turn = {
                    "id": turn_id,
                    "round_type": round_type.value,
                    "round_num": round_num,
                    "participant_id": participant["id"],
                    "content": "",
                    "status": "streaming",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                }
                session["turns"].append(turn)

                await _publish(session_id, {
                    "type": "turn_start",
                    "turn_id": turn_id,
                    "participant_id": participant["id"],
                    "participant_name": participant["name"],
                    "position": participant["position"],
                    "round": round_type.value,
                })

                messages = _build_context(session, round_type, participant, history)
                agent_cfg = dict(participant["agent_config"])
                # Decrypt key for use
                agent_cfg["api_key"] = crypto.decrypt(agent_cfg["api_key_enc"])

                try:
                    async for token in llm_client.stream(agent_cfg, messages):
                        turn["content"] += token
                        await _publish(session_id, {"type": "token", "turn_id": turn_id, "token": token})
                except Exception as e:
                    turn["status"] = "error"
                    await _publish(session_id, {"type": "error", "turn_id": turn_id, "message": str(e)})
                    continue

                turn["status"] = "completed"
                turn["completed_at"] = datetime.now(timezone.utc).isoformat()
                history.append(turn)

                await _publish(session_id, {"type": "turn_end", "turn_id": turn_id})

            await _publish(session_id, {"type": "round_end", "round": round_type.value})

        session["status"] = "completed"
        await _publish(session_id, {"type": "debate_end"})

    except Exception as e:
        session["status"] = "error"
        await _publish(session_id, {"type": "error", "message": str(e)})

    finally:
        # Signal stream is done
        await _publish(session_id, {"type": "done"})
