"""Customer chat routes: send a message, confirm an action, read history."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import AuthDep, ServicesDep, get_orchestrator
from app.contracts.assistant import AssistantResponse
from app.contracts.messages import ChatMessageInput, ConfirmActionInput
from app.core.context import AuthContext

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/messages", response_model=AssistantResponse)
async def send_message(
    body: ChatMessageInput,
    auth: AuthContext = AuthDep,
    orchestrator=Depends(get_orchestrator),
) -> AssistantResponse:
    return await orchestrator.handle_message(auth, body)


@router.post("/confirm", response_model=AssistantResponse)
async def confirm_action(
    body: ConfirmActionInput,
    auth: AuthContext = AuthDep,
    orchestrator=Depends(get_orchestrator),
) -> AssistantResponse:
    return await orchestrator.confirm(auth, body.conversation_id, body.proposal_id, body.confirm)


@router.get("/conversations")
async def list_conversations(auth: AuthContext = AuthDep, services=ServicesDep) -> list[dict]:
    convs = await services.repos.conversations.list_for_user(auth.org_id, auth.user_id)
    return [
        {
            "conversation_id": c.conversation_id,
            "updated_at": c.updated_at.isoformat(),
            "message_count": len(c.messages),
            "preview": c.messages[-1].content[:120] if c.messages else "",
        }
        for c in convs
    ]


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str, auth: AuthContext = AuthDep, services=ServicesDep
) -> dict:
    from app.core.errors import AppError, ErrorCode

    conv = await services.repos.conversations.get(auth.org_id, conversation_id)
    if conv is None or conv.user_id != auth.user_id:
        raise AppError(ErrorCode.CROSS_TENANT_ACCESS, "Conversation not found.")
    return conv.model_dump(mode="json")
