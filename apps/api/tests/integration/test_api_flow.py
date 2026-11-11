"""API-level flow tests via TestClient (seeded in-memory DB, mock provider).

These exercise the real routers, dependency wiring, auth and error handling
without needing MongoDB or any API key.
"""

from __future__ import annotations


def _login(client, code: str) -> str:
    resp = client.post("/auth/login", json={"login_code": code})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_health(api_client):
    resp = api_client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["provider"] == "mock"


def test_requires_auth(api_client):
    resp = api_client.post("/chat/messages", json={"message": "hi"})
    assert resp.status_code == 401


def test_full_cancellation_flow(api_client):
    token = _login(api_client, "alice-acme")
    # 1) Ask to cancel -> prepared proposal awaiting confirmation.
    resp = api_client.post(
        "/chat/messages",
        json={"message": "I want to cancel my subscription now"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["state"] == "awaiting_confirmation"
    assert body["proposal"] is not None
    assert body["intent"]["intent"] == "cancel_subscription"
    proposal_id = body["proposal"]["proposal_id"]
    conversation_id = body["conversation_id"]

    # 2) Confirm -> executed.
    confirm = api_client.post(
        "/chat/confirm",
        json={"conversation_id": conversation_id, "proposal_id": proposal_id, "confirm": True},
        headers=_auth(token),
    )
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["state"] == "action_completed"

    # 3) Subscription now reads as cancelled.
    sub = api_client.get("/me/subscription", headers=_auth(token))
    assert sub.json()["subscription"]["status"] == "cancelled"


def test_info_question_does_not_prepare(api_client):
    token = _login(api_client, "alice-acme")
    resp = api_client.post(
        "/chat/messages", json={"message": "How does cancellation work?"}, headers=_auth(token)
    )
    body = resp.json()
    assert body["state"] == "answered"
    assert body["proposal"] is None


def test_trace_is_inspectable(api_client):
    token = _login(api_client, "alice-acme")
    api_client.post("/chat/messages", json={"message": "What plan am I on?"}, headers=_auth(token))
    traces = api_client.get("/lab/traces", headers=_auth(token)).json()["traces"]
    assert traces
    cid = traces[0]["correlation_id"]
    detail = api_client.get(f"/lab/traces/{cid}", headers=_auth(token))
    assert detail.status_code == 200
    assert any(s["step"].startswith("tool:") for s in detail.json()["steps"])


def test_human_review_queue_is_staff_only(api_client):
    customer = _login(api_client, "alice-acme")
    # Customer cannot see the queue.
    assert api_client.get("/lab/reviews", headers=_auth(customer)).status_code == 403

    # Create a review by requesting a refund.
    api_client.post("/chat/messages", json={"message": "I want a refund"}, headers=_auth(customer))

    staff = _login(api_client, "dave-acme")
    reviews = api_client.get("/lab/reviews", headers=_auth(staff))
    assert reviews.status_code == 200
    assert len(reviews.json()["reviews"]) >= 1


def test_tenant_isolation_via_api(api_client):
    carol = _login(api_client, "carol-globex")
    sub = api_client.get("/me/subscription", headers=_auth(carol)).json()
    assert sub["subscription"]["org_id"] == "org_globex"


def test_contracts_and_tools_introspection(api_client):
    token = _login(api_client, "alice-acme")
    tools = api_client.get("/lab/tools", headers=_auth(token)).json()["tools"]
    names = {t["name"] for t in tools}
    assert {"get_subscription", "prepare_cancellation", "request_human_review"} <= names
    contracts = api_client.get("/lab/contracts", headers=_auth(token)).json()["contracts"]
    assert any(c["name"] == "IntentClassification" for c in contracts)
