from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum
import uuid


class SessionStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    stopped = "stopped"
    error = "error"


class SessionType(str, Enum):
    debate = "debate"
    meeting = "meeting"
    mafia = "mafia"


class Role(str, Enum):
    mafia = "mafia"
    doctor = "doctor"
    detective = "detective"
    villager = "villager"


class RoundType(str, Enum):
    opening = "opening"
    rebuttal = "rebuttal"
    closing = "closing"


class Position(str, Enum):
    for_ = "for"
    against = "against"
    neutral = "neutral"
    ceo = "ceo"
    pm = "pm"
    engineer = "engineer"
    designer = "designer"
    legal = "legal"
    player = "player"


class Provider(str, Enum):
    openai = "openai"
    anthropic = "anthropic"
    google = "google"
    custom = "custom"
    webhook = "webhook"


class Rules(BaseModel):
    max_words: int = 300
    rounds: int = 3
    public: bool = True
    # mafia-mode options (ignored by debate/meeting)
    mafia_count: int = 1
    use_doctor: bool = True
    use_detective: bool = True
    reveal_roles: bool = True
    discussion_rounds: int = 1
    house_rules: Optional[str] = None


class AgentConfig(BaseModel):
    provider: Provider
    model_id: str = ""
    api_key: str = ""          # raw key — only used on first save; cleared before storage
    key_handle_id: Optional[str] = None  # opaque handle returned by POST /key-handles
    system_prompt: Optional[str] = None
    base_url: Optional[str] = None  # for custom endpoints; for webhook: the agent URL


class ParticipantCreate(BaseModel):
    name: str
    position: Position
    agent_config: AgentConfig


class SessionCreate(BaseModel):
    topic: str
    rules: Rules = Field(default_factory=Rules)
    participants: list[ParticipantCreate]
    session_type: SessionType = SessionType.debate
    judge_config: Optional[AgentConfig] = None


class TurnStatus(str, Enum):
    pending = "pending"
    streaming = "streaming"
    completed = "completed"
    error = "error"
