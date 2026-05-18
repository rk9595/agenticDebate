from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum
import uuid


class SessionStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    error = "error"


class RoundType(str, Enum):
    opening = "opening"
    rebuttal = "rebuttal"
    closing = "closing"


class Position(str, Enum):
    for_ = "for"
    against = "against"
    neutral = "neutral"


class Provider(str, Enum):
    openai = "openai"
    anthropic = "anthropic"
    google = "google"
    custom = "custom"


class Rules(BaseModel):
    max_words: int = 300
    rounds: int = 3
    public: bool = True


class AgentConfig(BaseModel):
    provider: Provider
    model_id: str
    api_key: str  # raw key from user — encrypted before storage
    system_prompt: Optional[str] = None
    base_url: Optional[str] = None  # for custom endpoints


class ParticipantCreate(BaseModel):
    name: str
    position: Position
    agent_config: AgentConfig


class SessionCreate(BaseModel):
    topic: str
    rules: Rules = Field(default_factory=Rules)
    participants: list[ParticipantCreate]


class TurnStatus(str, Enum):
    pending = "pending"
    streaming = "streaming"
    completed = "completed"
    error = "error"
