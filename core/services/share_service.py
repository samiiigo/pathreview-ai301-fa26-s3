"""Signed, expiring capabilities for public review summaries."""

from datetime import timedelta
from time import time
from uuid import UUID

from core.security import create_access_token, decode_access_token


def create_review_share_token(review_id: UUID | str) -> str:
    """Create a 30-day review capability without an authentication subject.

    Args:
        review_id: Completed review to share after an ownership check.

    Returns:
        Signed JWT usable only by the public review endpoint.
    """
    return create_access_token(
        {"purpose": "review_share", "review_id": str(review_id)},
        expires_delta=timedelta(days=30),
    )


def decode_review_share_token(token: str) -> UUID | None:
    """Validate a review capability and return its review identifier.

    Args:
        token: Untrusted share token from a public URL.

    Returns:
        Review UUID, or None for invalid, expired, or wrong-purpose tokens.
    """
    try:
        payload = decode_access_token(token)
    except (TypeError, ValueError, OverflowError):
        # A correctly signed JWT can still have malformed registered claims.
        return None
    if (
        payload is None
        or payload.get("purpose") != "review_share"
        or not isinstance(payload.get("exp"), int | float)
        or not isinstance(payload.get("review_id"), str)
        or payload["exp"] <= time()
    ):
        return None
    try:
        return UUID(payload["review_id"])
    except ValueError:
        return None
