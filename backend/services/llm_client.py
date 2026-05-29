import json
from typing import AsyncIterator
from urllib.parse import urlparse

from models.session import Provider

WEBHOOK_TIMEOUT_SECS = 180.0

# http:// allowed for these hosts only; everything else must use https://
_LOCALHOST_HOSTS = {"localhost", "127.0.0.1", "::1"}


def validate_webhook_url(url: str) -> None:
    if not url or not url.strip():
        raise ValueError("Webhook URL is empty")
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Webhook URL must start with http:// or https://, got {parsed.scheme!r}")
    if parsed.scheme == "http":
        host = (parsed.hostname or "").lower()
        if host not in _LOCALHOST_HOSTS:
            raise ValueError(
                "Webhook URL must use HTTPS — http:// is only allowed for localhost (got host "
                f"{host!r})"
            )


async def stream(agent_config: dict, messages: list[dict]) -> AsyncIterator[str]:
    provider = agent_config["provider"]
    api_key = agent_config["api_key"]
    model_id = agent_config["model_id"]

    if provider == Provider.openai or provider == Provider.custom:
        async for token in _stream_openai(api_key, model_id, messages, agent_config.get("base_url")):
            yield token

    elif provider == Provider.anthropic:
        async for token in _stream_anthropic(api_key, model_id, messages):
            yield token

    elif provider == Provider.google:
        async for token in _stream_google(api_key, model_id, messages):
            yield token

    elif provider == Provider.webhook:
        url = agent_config.get("base_url")
        if not url:
            raise ValueError("Webhook provider requires base_url")
        async for token in _stream_webhook(url, api_key, messages):
            yield token

    else:
        raise ValueError(f"Unsupported provider: {provider}")


async def _stream_openai(api_key: str, model_id: str, messages: list[dict], base_url: str | None) -> AsyncIterator[str]:
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    stream = await client.chat.completions.create(
        model=model_id,
        messages=messages,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def _stream_anthropic(api_key: str, model_id: str, messages: list[dict]) -> AsyncIterator[str]:
    import anthropic

    system = None
    filtered = []
    for m in messages:
        if m["role"] == "system":
            system = m["content"]
        else:
            filtered.append(m)

    client = anthropic.AsyncAnthropic(api_key=api_key)
    kwargs = dict(model=model_id, max_tokens=1024, messages=filtered)
    if system:
        kwargs["system"] = system

    async with client.messages.stream(**kwargs) as s:
        async for text in s.text_stream:
            yield text


async def _stream_webhook(url: str, secret: str, messages: list[dict]) -> AsyncIterator[str]:
    import httpx

    validate_webhook_url(url)

    payload = {"messages": messages, "max_tokens": 1024}
    headers = {"Content-Type": "application/json"}
    if secret:
        headers["X-AgenticDebate-Secret"] = secret

    timeout = httpx.Timeout(WEBHOOK_TIMEOUT_SECS, connect=10.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")

            if "text/event-stream" in content_type:
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    token = event.get("token")
                    if token:
                        yield token
            else:
                body_bytes = await response.aread()
                try:
                    body = json.loads(body_bytes)
                except json.JSONDecodeError:
                    raise ValueError(f"Webhook returned non-JSON response: {body_bytes[:200]!r}")
                content = body.get("content") or ""
                if content:
                    yield content


async def _stream_google(api_key: str, model_id: str, messages: list[dict]) -> AsyncIterator[str]:
    from google import genai
    from google.genai import types

    system = None
    history = []
    for m in messages:
        if m["role"] == "system":
            system = m["content"]
        else:
            role = "model" if m["role"] == "assistant" else "user"
            history.append(types.Content(role=role, parts=[types.Part(text=m["content"])]))

    client = genai.Client(api_key=api_key)
    config = types.GenerateContentConfig(
        system_instruction=system,
        max_output_tokens=1024,
    )

    async for chunk in client.aio.models.generate_content_stream(
        model=model_id,
        contents=history,
        config=config,
    ):
        if chunk.text:
            yield chunk.text
