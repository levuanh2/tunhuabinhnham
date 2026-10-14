import threading
import uuid
from collections.abc import Generator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.config import get_settings
from app.main import app
from app.models import ContactClick, Product, PublishStatus

URL = "/api/v1/contact-clicks"


@pytest.fixture(autouse=True)
def fresh_limits() -> Generator[None, None, None]:
    rate_limit.contact_client_rate_limiter._entries.clear()
    rate_limit.contact_global_rate_limiter._entries.clear()
    yield
    app.dependency_overrides.pop(get_settings, None)


def configure(**changes: object) -> None:
    settings = get_settings().model_copy(update=changes)
    app.dependency_overrides[get_settings] = lambda: settings


def rows(db: Session) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(ContactClick)) or 0


def product(db: Session, **changes: object) -> Product:
    item = Product(
        name="Tủ",
        slug=f"tu-{uuid.uuid4().hex[:6]}",
        sku=f"SKU-{uuid.uuid4().hex[:6]}",
        publish_status=PublishStatus.published,
        is_visible=True,
        published_at=datetime.now(UTC),
    )
    for key, value in changes.items():
        setattr(item, key, value)
    db.add(item)
    db.commit()
    return item


def test_valid_click_is_stored_without_ip(client: TestClient, db: Session) -> None:
    item = product(db)
    response = client.post(URL, json={"product_id": str(item.id), "source": "product_detail"})
    assert response.status_code == 202
    assert response.json() == {"accepted": True}
    stored = db.scalar(select(ContactClick))
    assert stored is not None and stored.product_id == item.id and stored.ip_hash is None
    assert client.post(URL, json={}).status_code == 202
    assert rows(db) == 2


@pytest.mark.parametrize("state", ["missing", "draft", "hidden", "deleted"])
def test_unknown_or_non_public_product_is_422(
    client: TestClient, db: Session, state: str
) -> None:
    if state == "missing":
        product_id = uuid.uuid4()
    else:
        changes: dict[str, object] = {
            "draft": {"publish_status": PublishStatus.draft},
            "hidden": {"is_visible": False},
            "deleted": {"deleted_at": datetime.now(UTC)},
        }[state]
        product_id = product(db, **changes).id
    response = client.post(URL, json={"product_id": str(product_id)})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "http_422"
    assert rows(db) == 0


@pytest.mark.parametrize(
    "body",
    [
        {"product_id": "not-a-uuid"},
        {"source": "evil"},
        {"product_id": 123},
        "not json",
    ],
)
def test_malformed_body_is_422(client: TestClient, db: Session, body: object) -> None:
    kwargs = {"content": body, "headers": {"content-type": "application/json"}} if isinstance(
        body, str
    ) else {"json": body}
    response = client.post(URL, **kwargs)  # type: ignore[arg-type]
    assert response.status_code == 422
    assert rows(db) == 0


def test_rapid_repeats_get_429_then_recover(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure(contact_click_limit_per_minute=3)
    clock = [1000.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: clock[0])
    assert [client.post(URL, json={}).status_code for _ in range(3)] == [202, 202, 202]
    limited = client.post(URL, json={})
    assert limited.status_code == 429
    assert 1 <= int(limited.headers["retry-after"]) <= 60
    assert rows(db) == 3
    clock[0] += 61
    assert client.post(URL, json={}).status_code == 202
    assert rows(db) == 4


def test_global_cap_holds_across_clients(client: TestClient, db: Session) -> None:
    configure(client_ip_header="cf-connecting-ip", contact_click_global_limit_per_hour=2)
    codes = [
        client.post(URL, json={}, headers={"cf-connecting-ip": f"203.0.113.{i}"}).status_code
        for i in range(4)
    ]
    assert codes == [202, 202, 429, 429]
    assert rows(db) == 2


def test_spoofed_ip_headers_do_not_bypass_the_limit(client: TestClient, db: Session) -> None:
    # Header not configured: client-supplied headers are ignored.
    configure(contact_click_limit_per_minute=2, client_ip_header="")
    codes = [
        client.post(URL, json={}, headers={"cf-connecting-ip": f"198.51.100.{i}"}).status_code
        for i in range(3)
    ]
    assert codes == [202, 202, 429]
    # Header configured but not a single valid IP (e.g. a forged list): falls back to the peer.
    rate_limit.contact_client_rate_limiter._entries.clear()
    configure(contact_click_limit_per_minute=2, client_ip_header="cf-connecting-ip")
    forged = ["1.1.1.1, 2.2.2.2", "garbage", "3.3.3.3, 4.4.4.4"]
    codes = [
        client.post(URL, json={}, headers={"cf-connecting-ip": value}).status_code
        for value in forged
    ]
    assert codes == [202, 202, 429]


def test_ipv6_clients_are_grouped_by_64(client: TestClient) -> None:
    configure(contact_click_limit_per_minute=2, client_ip_header="cf-connecting-ip")
    codes = [
        client.post(URL, json={}, headers={"cf-connecting-ip": f"2001:db8:1:2::{i}"}).status_code
        for i in range(1, 4)
    ]
    assert codes == [202, 202, 429]


def test_rate_limit_runs_before_the_database(client: TestClient, db: Session) -> None:
    configure(contact_click_limit_per_minute=1)
    client.post(URL, json={})
    response = client.post(URL, json={"product_id": str(uuid.uuid4())})
    assert response.status_code == 429  # not 422: rejected before any lookup
    assert rows(db) == 1


def test_concurrent_requests_never_exceed_the_limit() -> None:
    limiter = rate_limit.FixedWindowRateLimiter()
    allowed: list[bool] = []
    barrier = threading.Barrier(40)

    def hit() -> None:
        barrier.wait()
        allowed.append(limiter.retry_after("client", limit=10) is None)

    threads = [threading.Thread(target=hit) for _ in range(40)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert allowed.count(True) == 10


def test_limiter_memory_is_bounded_and_recovers(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [0.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: clock[0])
    limiter = rate_limit.FixedWindowRateLimiter(max_keys=3)
    assert [limiter.retry_after(f"ip{i}", limit=5) for i in range(3)] == [None, None, None]
    assert limiter.retry_after("ip-new", limit=5) == 60  # full of live windows: refused
    assert limiter.retry_after("ip0", limit=5) is None  # known keys still counted
    assert len(limiter._entries) == 3
    clock[0] += 61  # windows expired: pruned, new keys accepted again
    assert limiter.retry_after("ip-new", limit=5) is None
    assert len(limiter._entries) == 1
