from typing import AsyncIterator
from models.session import Provider


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
