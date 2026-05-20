import asyncio
import re
import uuid
from datetime import datetime, timezone
from models.session import RoundType
from services import llm_client, crypto, db

# Live-streaming queues: only held in memory for active debates
stream_queues: dict[str, asyncio.Queue] = {}

ROUND_SEQUENCE = [RoundType.opening, RoundType.rebuttal, RoundType.closing]

ROUND_INSTRUCTIONS = {
    RoundType.opening: "Give your opening statement. Clearly state your position and your strongest arguments.",
    RoundType.rebuttal: "Rebut your opponent's arguments. Address their specific points and reinforce your own position.",
    RoundType.closing: "Give your closing statement. Summarize your strongest points and explain why your position prevails.",
}

CLOSING_ORDER_REVERSED = True

MEETING_ROLE_PROMPTS = {
    "ceo": "You are the CEO. Focus on strategic business impact, company vision, resource allocation, and executive decision-making. Be decisive and think long-term.",
    "pm": "You are the Product Manager. Focus on user needs, product requirements, timelines, scope management, and feature prioritization. Balance stakeholder expectations.",
    "engineer": "You are the Lead Engineer. Focus on technical feasibility, implementation complexity, system architecture, technical debt, and realistic delivery timelines.",
    "designer": "You are the UX Designer. Focus on user experience, interface consistency, accessibility standards, and design principles.",
    "legal": "You are Legal counsel. Focus on regulatory compliance, risk mitigation, liability concerns, and contractual obligations.",
}

MEETING_ROUND_INSTRUCTIONS = {
    "briefing": "Give your opening perspective on this agenda item. State your key concerns, priorities, and initial stance from your role's viewpoint.",
    "discussion": "Respond to your colleagues' points. Address their concerns from your role's perspective, push back where needed, and ask clarifying questions.",
    "consensus": "Give your final recommendation. State clearly what you believe the team should decide and why, from your role's perspective.",
}


def _build_context(session: dict, participants: list[dict], round_type: RoundType, participant: dict, history: list[dict]) -> list[dict]:
    system_prompt = participant["agent_config"].get("system_prompt") or (
        f"You are a skilled debater arguing the {participant['position']} side."
    )

    history_text = ""
    for turn in history:
        p = next(p for p in participants if p["id"] == turn["participant_id"])
        history_text += f"\n\n[{p['name']} — {p['position'].upper()}]\n{turn['content']}"

    rules = session["rules"]
    user_content = (
        f"Topic: \"{session['topic']}\"\n"
        f"Your position: {participant['position'].upper()}\n"
        f"Round: {round_type.value} ({session['current_round_num']} of {rules['rounds']})\n"
    )
    if history_text:
        user_content += f"\nDebate so far:{history_text}\n"
    user_content += f"\n{ROUND_INSTRUCTIONS[round_type]} Max {rules['max_words']} words."

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]


def _build_meeting_context(session: dict, participants: list[dict], round_type: str, participant: dict, history: list[dict]) -> list[dict]:
    role = participant["position"]
    system_prompt = participant["agent_config"].get("system_prompt") or MEETING_ROLE_PROMPTS.get(
        role, f"You are a {role} participating in this meeting."
    )

    history_text = ""
    for turn in history:
        p = next(p for p in participants if p["id"] == turn["participant_id"])
        history_text += f"\n\n[{p['name']} — {p['position'].upper()}]\n{turn['content']}"

    rules = session["rules"]
    user_content = (
        f"Meeting agenda: \"{session['topic']}\"\n"
        f"Your role: {role.upper()}\n"
        f"Meeting phase: {round_type}\n"
    )
    if history_text:
        user_content += f"\nDiscussion so far:{history_text}\n"
    user_content += f"\n{MEETING_ROUND_INSTRUCTIONS[round_type]} Max {rules['max_words']} words."

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]


def _build_judge_turn_context(session: dict, participants: list[dict], prior_history: list[dict], current_content: str, current_participant: dict) -> list[dict]:
    history_text = ""
    for turn in prior_history:
        p = next(p for p in participants if p["id"] == turn["participant_id"])
        history_text += f"\n\n[{p['name']} — {p['position'].upper()}]\n{turn['content']}"

    current_name = current_participant["name"]
    current_pos = current_participant["position"].upper()

    user = f'Topic: "{session["topic"]}"\n'
    if history_text:
        user += f"Debate so far:{history_text}\n\n"
    user += (
        f"[{current_name} — {current_pos}]\n{current_content}\n\n"
        f"Score this argument 1–10 on argument quality, use of evidence, and rhetorical effectiveness. "
        f"Reply as:\nScore: X/10\n\n[reasoning, max 80 words]"
    )
    return [
        {"role": "system", "content": "You are an impartial debate judge. Evaluate arguments on merit, evidence, and rhetoric."},
        {"role": "user", "content": user},
    ]


def _build_judge_final_context(session: dict, participants: list[dict], history: list[dict]) -> list[dict]:
    history_text = ""
    for turn in history:
        p = next(p for p in participants if p["id"] == turn["participant_id"])
        history_text += f"\n\n[{p['name']} — {p['position'].upper()}]\n{turn['content']}"

    user = (
        f'Topic: "{session["topic"]}"\n'
        f"Complete debate:{history_text}\n\n"
        f"Based on the full debate, declare a winner. Reply as:\nWinner: for/against/tie\n\n[reasoning, max 100 words]"
    )
    return [
        {"role": "system", "content": "You are an impartial debate judge."},
        {"role": "user", "content": user},
    ]


def _parse_score(content: str) -> int | None:
    m = re.search(r"Score:\s*(\d+)", content, re.IGNORECASE)
    if m:
        val = int(m.group(1))
        return max(1, min(10, val))
    return None


def _parse_winner(content: str) -> str | None:
    m = re.search(r"Winner:\s*(for|against|tie)", content, re.IGNORECASE)
    return m.group(1).lower() if m else None


async def _run_judge_turn(
    session_id: str,
    session: dict,
    participants: list[dict],
    participant: dict,
    turn_id: str,
    current_content: str,
    prior_history: list[dict],
    round_type,
    round_num: int,
    judge_cfg_raw: dict,
):
    judgment_id = str(uuid.uuid4())
    await _publish(session_id, {
        "type": "judgment_start",
        "judgment_id": judgment_id,
        "turn_id": turn_id,
        "participant_id": participant["id"],
        "participant_name": participant["name"],
    })

    messages = _build_judge_turn_context(session, participants, prior_history, current_content, participant)
    agent_cfg = dict(judge_cfg_raw)
    agent_cfg["api_key"] = crypto.decrypt(agent_cfg["api_key_enc"])

    content = ""
    status = "completed"
    try:
        async for token in llm_client.stream(agent_cfg, messages):
            content += token
            await _publish(session_id, {"type": "judgment_token", "judgment_id": judgment_id, "token": token})
    except Exception as e:
        status = "error"
        await _publish(session_id, {"type": "error", "message": f"Judge error: {e}"})

    score = _parse_score(content)
    round_val = round_type.value if hasattr(round_type, "value") else round_type
    await db.save_judgment({
        "id": judgment_id,
        "session_id": session_id,
        "turn_id": turn_id,
        "participant_id": participant["id"],
        "round_type": round_val,
        "round_num": round_num,
        "score": score,
        "reasoning": content,
        "status": status,
    })
    await _publish(session_id, {
        "type": "judgment_end",
        "judgment_id": judgment_id,
        "turn_id": turn_id,
        "score": score,
    })


async def _run_judge_final(
    session_id: str,
    session: dict,
    participants: list[dict],
    history: list[dict],
    judge_cfg_raw: dict,
):
    judgment_id = str(uuid.uuid4())
    await _publish(session_id, {"type": "verdict_start", "judgment_id": judgment_id})

    messages = _build_judge_final_context(session, participants, history)
    agent_cfg = dict(judge_cfg_raw)
    agent_cfg["api_key"] = crypto.decrypt(agent_cfg["api_key_enc"])

    content = ""
    status = "completed"
    try:
        async for token in llm_client.stream(agent_cfg, messages):
            content += token
            await _publish(session_id, {"type": "verdict_token", "judgment_id": judgment_id, "token": token})
    except Exception as e:
        status = "error"
        await _publish(session_id, {"type": "error", "message": f"Judge final error: {e}"})

    winner = _parse_winner(content)
    await db.save_judgment({
        "id": judgment_id,
        "session_id": session_id,
        "turn_id": None,
        "participant_id": None,
        "round_type": None,
        "round_num": None,
        "score": None,
        "reasoning": content,
        "status": status,
    })
    if winner:
        await db.update_session_winner(session_id, winner, content)
    await _publish(session_id, {
        "type": "verdict_end",
        "judgment_id": judgment_id,
        "winner": winner,
        "reasoning": content,
    })


async def _publish(session_id: str, event: dict):
    q = stream_queues.get(session_id)
    if q:
        await q.put(event)


async def run(session_id: str):
    session = await db.get_session(session_id)
    participants = await db.get_participants(session_id)
    history: list[dict] = []
    judge_cfg = session.get("judge_config")

    await db.update_session_status(session_id, "running")

    try:
        rounds = ROUND_SEQUENCE[:session["rules"]["rounds"]]

        for round_num, round_type in enumerate(rounds, start=1):
            await db.update_session_status(session_id, "running", current_round_num=round_num)
            session["current_round_num"] = round_num

            ordered = list(reversed(participants)) if (round_type == RoundType.closing and CLOSING_ORDER_REVERSED) else participants

            await _publish(session_id, {"type": "round_start", "round": round_type.value, "round_num": round_num})

            for participant in ordered:
                turn_id = str(uuid.uuid4())
                started_at = datetime.now(timezone.utc).isoformat()

                await _publish(session_id, {
                    "type": "turn_start",
                    "turn_id": turn_id,
                    "participant_id": participant["id"],
                    "participant_name": participant["name"],
                    "position": participant["position"],
                    "round": round_type.value,
                })

                messages = _build_context(session, participants, round_type, participant, history)
                agent_cfg = dict(participant["agent_config"])
                agent_cfg["api_key"] = crypto.decrypt(agent_cfg["api_key_enc"])

                content = ""
                turn_status = "completed"

                try:
                    async for token in llm_client.stream(agent_cfg, messages):
                        content += token
                        await _publish(session_id, {"type": "token", "turn_id": turn_id, "token": token})
                except Exception as e:
                    turn_status = "error"
                    await _publish(session_id, {"type": "error", "turn_id": turn_id, "message": str(e)})

                completed_at = datetime.now(timezone.utc).isoformat()
                turn = {
                    "id": turn_id,
                    "session_id": session_id,
                    "participant_id": participant["id"],
                    "round_type": round_type.value,
                    "round_num": round_num,
                    "content": content,
                    "status": turn_status,
                    "started_at": started_at,
                    "completed_at": completed_at,
                }
                await db.save_turn(turn)

                prior_history = list(history)
                if turn_status == "completed":
                    history.append(turn)

                await _publish(session_id, {"type": "turn_end", "turn_id": turn_id})

                if judge_cfg and turn_status == "completed":
                    await _run_judge_turn(
                        session_id, session, participants, participant,
                        turn_id, content, prior_history, round_type, round_num, judge_cfg,
                    )

            await _publish(session_id, {"type": "round_end", "round": round_type.value})

        if judge_cfg and history:
            await _run_judge_final(session_id, session, participants, history, judge_cfg)

        await db.update_session_status(session_id, "completed")
        await _publish(session_id, {"type": "debate_end"})

    except Exception as e:
        await db.update_session_status(session_id, "error")
        await _publish(session_id, {"type": "error", "message": str(e)})

    finally:
        await _publish(session_id, {"type": "done"})
        stream_queues.pop(session_id, None)


async def run_meeting(session_id: str):
    session = await db.get_session(session_id)
    participants = await db.get_participants(session_id)
    history: list[dict] = []

    await db.update_session_status(session_id, "running")

    try:
        discussion_rounds = session["rules"]["rounds"]
        # briefing (1) + N discussion rounds + consensus (1)
        round_sequence = (
            [("briefing", 1)]
            + [("discussion", i + 2) for i in range(discussion_rounds)]
            + [("consensus", discussion_rounds + 2)]
        )

        for round_type, round_num in round_sequence:
            await db.update_session_status(session_id, "running", current_round_num=round_num)
            session["current_round_num"] = round_num

            await _publish(session_id, {"type": "round_start", "round": round_type, "round_num": round_num})

            for participant in participants:
                turn_id = str(uuid.uuid4())
                started_at = datetime.now(timezone.utc).isoformat()

                await _publish(session_id, {
                    "type": "turn_start",
                    "turn_id": turn_id,
                    "participant_id": participant["id"],
                    "participant_name": participant["name"],
                    "position": participant["position"],
                    "round": round_type,
                })

                messages = _build_meeting_context(session, participants, round_type, participant, history)
                agent_cfg = dict(participant["agent_config"])
                agent_cfg["api_key"] = crypto.decrypt(agent_cfg["api_key_enc"])

                content = ""
                turn_status = "completed"

                try:
                    async for token in llm_client.stream(agent_cfg, messages):
                        content += token
                        await _publish(session_id, {"type": "token", "turn_id": turn_id, "token": token})
                except Exception as e:
                    turn_status = "error"
                    await _publish(session_id, {"type": "error", "turn_id": turn_id, "message": str(e)})

                completed_at = datetime.now(timezone.utc).isoformat()
                turn = {
                    "id": turn_id,
                    "session_id": session_id,
                    "participant_id": participant["id"],
                    "round_type": round_type,
                    "round_num": round_num,
                    "content": content,
                    "status": turn_status,
                    "started_at": started_at,
                    "completed_at": completed_at,
                }
                await db.save_turn(turn)

                if turn_status == "completed":
                    history.append(turn)

                await _publish(session_id, {"type": "turn_end", "turn_id": turn_id})

            await _publish(session_id, {"type": "round_end", "round": round_type})

        await db.update_session_status(session_id, "completed")
        await _publish(session_id, {"type": "debate_end"})

    except Exception as e:
        await db.update_session_status(session_id, "error")
        await _publish(session_id, {"type": "error", "message": str(e)})

    finally:
        await _publish(session_id, {"type": "done"})
        stream_queues.pop(session_id, None)
