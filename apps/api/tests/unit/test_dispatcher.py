"""ToolDispatcher guard rails: not-found, state, args, authorization, success."""

from __future__ import annotations

import pytest

from app.ai.observability.trace import Trace
from app.ai.tools.dispatcher import ToolDispatcher
from app.ai.tools.names import GET_BILLING_HISTORY, GET_SUBSCRIPTION
from app.ai.tools.registry import ToolDefinition, build_registry
from app.contracts.tools import ToolCall
from app.core.context import Role
from app.core.errors import AppError, ErrorCode
from app.services.container import Services


def _trace(auth):
    return Trace(correlation_id="t", org_id=auth.org_id, user_id=auth.user_id)


def _call(name, **args):
    return ToolCall(id="call_1", name=name, arguments=args)


async def test_success(services: Services, alice):
    disp = ToolDispatcher(build_registry())
    res = await disp.dispatch(
        _call(GET_SUBSCRIPTION), auth=alice, services=services, trace=_trace(alice)
    )
    assert res.ok is True
    assert res.data["subscription_id"].startswith("sub_")


async def test_tool_not_found(services: Services, alice):
    disp = ToolDispatcher(build_registry())
    res = await disp.dispatch(
        _call("does_not_exist"), auth=alice, services=services, trace=_trace(alice)
    )
    assert res.ok is False
    assert res.error_code == ErrorCode.TOOL_NOT_FOUND.value


async def test_not_available_in_state(services: Services, alice):
    disp = ToolDispatcher(build_registry())
    res = await disp.dispatch(
        _call(GET_BILLING_HISTORY),
        auth=alice,
        services=services,
        trace=_trace(alice),
        allowed={GET_SUBSCRIPTION},
    )
    assert res.ok is False
    assert res.error_code == ErrorCode.TOOL_NOT_AVAILABLE_IN_STATE.value


async def test_invalid_arguments(services: Services, alice):
    disp = ToolDispatcher(build_registry())
    res = await disp.dispatch(
        _call(GET_BILLING_HISTORY, limit=999), auth=alice, services=services, trace=_trace(alice)
    )
    assert res.ok is False
    assert res.error_code == ErrorCode.TOOL_ARGS_INVALID.value


def test_authorization_rejects_wrong_role(alice):
    from app.ai.tools.schemas import EmptyArgs

    async def _h(ctx, args):  # pragma: no cover - not executed
        return {}

    definition = ToolDefinition(
        name="admin_only",
        description="x",
        args_model=EmptyArgs,
        handler=_h,
        allowed_roles=(Role.ADMIN,),
    )
    with pytest.raises(AppError) as exc:
        definition.authorize(alice)
    assert exc.value.code == ErrorCode.TOOL_NOT_AUTHORIZED
