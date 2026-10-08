"""Exercise the real review routes and JWT validation without external services."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt

from api.middleware.auth import get_current_user
from api.routes.reviews import router
from core.config import settings
from core.database import get_db
from core.security import create_access_token

pytestmark = pytest.mark.unit


@pytest.fixture
def sharing():
    """Use production routes with an isolated database dependency."""
    review = SimpleNamespace(
        id=uuid4(),
        profile_id=uuid4(),
        status="complete",
        overall_score=0.81,
        sections=[
            {
                "section_name": "Skills",
                "content": "Useful feedback",
                "confidence": 0.9,
                "suggestions": ["Add examples"],
            }
        ],
        error_message="private diagnostic",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    result = Mock()
    result.scalars.return_value.first.return_value = review
    db = SimpleNamespace(execute=AsyncMock(return_value=result))
    user = SimpleNamespace(id=uuid4())
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        yield SimpleNamespace(
            app=app, client=client, review=review, db=db, result=result, user=user
        )


def signed_token(review_id, **changes):
    """Create test input with deliberately controlled claims."""
    claims = {
        "purpose": "review_share",
        "review_id": str(review_id),
        "exp": datetime.now(UTC) + timedelta(days=30),
    }
    claims.update(changes)
    return jwt.encode(claims, settings.secret_key, algorithm=settings.jwt_algorithm)


def test_owner_can_create_link_and_anonymous_reader_gets_only_summary(sharing):
    response = sharing.client.post(f"/reviews/{sharing.review.id}/share")
    assert response.status_code == 200
    token = response.json()["token"]
    claims = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    assert 30 * 86400 - 5 <= claims["exp"] - datetime.now(UTC).timestamp() <= 30 * 86400
    assert "sub" not in claims
    # Existing owner-checked query must include the caller and review id.
    query = sharing.db.execute.call_args.args[0]
    assert sharing.user.id in query.compile().params.values()
    assert sharing.review.id in query.compile().params.values()
    sharing.app.dependency_overrides.pop(get_current_user)
    response = sharing.client.get(f"/reviews/shared/{token}")
    assert response.status_code == 200
    assert response.json() == {"overall_score": 0.81, "sections": sharing.review.sections}


def test_share_creation_requires_login(sharing):
    sharing.app.dependency_overrides.pop(get_current_user)
    assert sharing.client.post(f"/reviews/{sharing.review.id}/share").status_code == 401
    sharing.db.execute.assert_not_awaited()


def test_nonowner_or_missing_review_cannot_be_shared(sharing):
    sharing.result.scalars.return_value.first.return_value = None
    assert sharing.client.post(f"/reviews/{sharing.review.id}/share").status_code == 404


@pytest.mark.parametrize("state", ["pending", "processing", "failed"])
def test_only_complete_reviews_can_be_shared(sharing, state):
    sharing.review.status = state
    assert sharing.client.post(f"/reviews/{sharing.review.id}/share").status_code == 409
    token = signed_token(sharing.review.id)
    assert sharing.client.get(f"/reviews/shared/{token}").status_code == 404


@pytest.mark.parametrize(
    "kind", ["expired", "malformed", "login", "wrong-purpose", "no-exp", "bad-id", "tampered"]
)
def test_invalid_tokens_are_rejected_before_database_lookup(sharing, kind):
    claims = {
        "purpose": "review_share",
        "review_id": str(sharing.review.id),
        "exp": datetime.now(UTC) + timedelta(days=30),
    }
    if kind == "expired":
        claims["exp"] = datetime.now(UTC) - timedelta(seconds=1)
    elif kind == "wrong-purpose":
        claims["purpose"] = "login"
    elif kind == "no-exp":
        del claims["exp"]
    elif kind == "bad-id":
        claims["review_id"] = "not-a-uuid"
    token = jwt.encode(claims, settings.secret_key, algorithm=settings.jwt_algorithm)
    if kind == "malformed":
        token = "not-a-token"
    elif kind == "login":
        token = create_access_token({"sub": str(sharing.user.id)})
    elif kind == "tampered":
        token = jwt.encode(claims, "wrong-signing-key", algorithm=settings.jwt_algorithm)
    assert sharing.client.get(f"/reviews/shared/{token}").status_code == 404
    sharing.db.execute.assert_not_awaited()


def test_missing_review_is_not_exposed(sharing):
    sharing.result.scalars.return_value.first.return_value = None
    token = signed_token(sharing.review.id)
    assert sharing.client.get(f"/reviews/shared/{token}").status_code == 404


@pytest.mark.parametrize("expiry", [None, [], {}, "tomorrow", True, float("inf")])
def test_invalid_expiry_claim_cannot_crash_public_endpoint(sharing, expiry):
    token = signed_token(sharing.review.id, exp=expiry)
    assert sharing.client.get(f"/reviews/shared/{token}").status_code == 404
    sharing.db.execute.assert_not_awaited()


def test_share_token_cannot_authenticate_and_owner_route_stays_protected(sharing):
    response = sharing.client.post(f"/reviews/{sharing.review.id}/share")
    assert response.status_code == 200
    token = response.json()["token"]
    sharing.app.dependency_overrides.pop(get_current_user)
    sharing.db.execute.reset_mock()
    assert sharing.client.get(f"/reviews/{sharing.review.id}").status_code == 401
    response = sharing.client.get(
        f"/reviews/{sharing.review.id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 401
    sharing.db.execute.assert_not_awaited()
