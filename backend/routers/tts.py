import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from services import crypto, db

router = APIRouter(tags=["tts"])

ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
DEFAULT_MODEL = "eleven_turbo_v2_5"
MAX_TTS_CHARS = 5000


class TTSRequest(BaseModel):
    voice_id: str
    text: str
    key_handle_id: str | None = None
    api_key: str | None = None
    model_id: str | None = None


@router.post("/tts")
async def text_to_speech(body: TTSRequest):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "text is required")
    if len(text) > MAX_TTS_CHARS:
        text = text[:MAX_TTS_CHARS]
    if not body.voice_id:
        raise HTTPException(400, "voice_id is required")

    if body.key_handle_id:
        enc = await db.get_key_handle(body.key_handle_id)
        if not enc:
            raise HTTPException(400, "Invalid key_handle_id")
        api_key = crypto.decrypt(enc)
    elif body.api_key:
        api_key = body.api_key
    else:
        raise HTTPException(400, "key_handle_id or api_key is required")

    url = ELEVENLABS_URL.format(voice_id=body.voice_id)
    headers = {"xi-api-key": api_key, "Content-Type": "application/json"}
    payload = {
        "text": text,
        "model_id": body.model_id or DEFAULT_MODEL,
        "voice_settings": {"stability": 0.4, "similarity_boost": 0.75},
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
            r = await client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"ElevenLabs request failed: {e}")

    if r.status_code >= 400:
        snippet = r.text[:200]
        raise HTTPException(r.status_code, f"ElevenLabs error: {snippet}")

    return Response(content=r.content, media_type="audio/mpeg")
