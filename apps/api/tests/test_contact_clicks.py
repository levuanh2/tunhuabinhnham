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
    for limiter in vars(rate_limit).values():
        if isinstance(limiter, rate_limit.FixedWindowRateLimiter):
            limiter._entries.clear()
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
    sources = ["product_detail", "product_card", "contact_page", "unknown"]
    assert [client.post(URL, json={"source": s}).status_code for s in sources[:3]] == [202] * 3
    limited = client.post(URL, json={"source": "unknown"})
    assert limited.status_code == 429
    assert 1 <= int(limited.headers["retry-after"]) <= 60
    assert rows(db) == 3
    clock[0] += 61
    assert client.post(URL, json={"source": "unknown"}).status_code == 202
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


def test_default_config_ignores_other_forwarding_headers(client: TestClient) -> None:
    # Measured 2026-10-14 on onrender.com: Cloudflare overwrites CF-Connecting-IP and
    # True-Client-IP, answers a client-sent CF-Connecting-IP with 403 (error 1000), and keeps a
    # client-sent X-Forwarded-For as the first entry. Only CF-Connecting-IP may be trusted.
    configure(contact_click_limit_per_minute=2)
    assert get_settings().client_ip_header == "CF-Connecting-IP"
    codes = [
        client.post(
            URL,
            json={},
            headers={
                "cf-connecting-ip": "203.0.113.50",
                "x-forwarded-for": f"198.51.100.{i}",
                "true-client-ip": f"198.51.100.{i}",
                "x-real-ip": f"198.51.100.{i}",
            },
        ).status_code
        for i in range(3)
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
    entries = limiter._entries
    clock[0] += 30
    for i in range(100):  # repeated overflow: O(1) refusals, no re-prune until the oldest expires
        assert limiter.retry_after(f"flood{i}", limit=5) == 30
    assert limiter._entries is entries
    clock[0] -= 30
    assert limiter.retry_after("ip0", limit=5) is None  # known keys still counted
    assert len(limiter._entries) == 3
    clock[0] += 61  # windows expired: pruned, new keys accepted again
    assert limiter.retry_after("ip-new", limit=5) is None
    assert len(limiter._entries) == 1


# V1-SEC-05: one visitor must not use up the site-wide hourly quota, and only clicks that are
# stored may count against it.


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    now = [10_000.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: now[0])
    return now


def click(client: TestClient, ip: str, body: dict[str, object] | None = None) -> int:
    response = client.post(URL, json=body or {}, headers={"cf-connecting-ip": ip})
    return response.status_code


def test_one_spamming_visitor_cannot_starve_the_others(
    client: TestClient, db: Session, clock: list[float]
) -> None:
    configure(client_ip_header="cf-connecting-ip")  # production defaults: 10/min, 20/h, 300/h site
    item = product(db)
    for minute in range(60):  # a full hour at the per-minute limit, distinct clicks
        for i in range(10):
            click(client, "203.0.113.66", {"product_id": str(item.id) if i % 2 else None,
                                           "source": ["product_detail", "product_card",
                                                      "contact_page", "unknown"][i % 4]})
        clock[0] += 61 if minute % 2 else 1
    spam = rows(db)
    assert spam == 20  # contact_click_client_limit_per_hour: 20 of the site's 300 per hour
    assert click(client, "198.51.100.7") == 202  # another visitor is still counted
    assert rows(db) == spam + 1


def test_refused_and_invalid_requests_use_no_site_wide_quota(
    client: TestClient, db: Session, clock: list[float]
) -> None:
    configure(client_ip_header="cf-connecting-ip", contact_click_limit_per_minute=1000,
              contact_click_global_limit_per_hour=2)
    hidden = product(db, is_visible=False)
    for i in range(20):  # unknown and non-public products are refused before any quota
        assert click(client, f"192.0.2.{i}", {"product_id": str(uuid.uuid4())}) == 422
        assert click(client, f"192.0.2.{i}", {"product_id": str(hidden.id)}) == 422
    assert [click(client, "203.0.113.1"), click(client, "203.0.113.2")] == [202, 202]
    assert rows(db) == 2


def test_disabled_tracking_uses_no_quota(client: TestClient, db: Session, clock: list[float]) -> None:
    from app.models import SiteSettings

    configure(client_ip_header="cf-connecting-ip", contact_click_global_limit_per_hour=1)
    settings = db.scalar(select(SiteSettings)) or SiteSettings()
    settings.contact_tracking_enabled = False
    db.add(settings)
    db.commit()
    for i in range(5):
        response = client.post(URL, json={}, headers={"cf-connecting-ip": f"192.0.2.{i}"})
        assert response.json() == {"accepted": False}
    settings.contact_tracking_enabled = True
    db.commit()
    assert click(client, "203.0.113.9") == 202
    assert rows(db) == 1


def test_the_same_click_repeated_quickly_is_stored_once(
    client: TestClient, db: Session, clock: list[float]
) -> None:
    configure(client_ip_header="cf-connecting-ip")
    item = product(db)
    body = {"product_id": str(item.id), "source": "product_detail"}
    answers = [client.post(URL, json=body, headers={"cf-connecting-ip": "203.0.113.5"}).json()
               for _ in range(4)]
    assert answers == [{"accepted": True}] + [{"accepted": False}] * 3
    assert rows(db) == 1
    other = {"product_id": str(item.id), "source": "product_card"}
    assert client.post(URL, json=other, headers={"cf-connecting-ip": "203.0.113.5"}).json() == {"accepted": True}
    assert client.post(URL, json=body, headers={"cf-connecting-ip": "198.51.100.5"}).json() == {"accepted": True}
    clock[0] += 31  # a later click on the same button counts again
    assert client.post(URL, json=body, headers={"cf-connecting-ip": "203.0.113.5"}).json() == {"accepted": True}
    assert rows(db) == 4


def test_rotating_forged_forwarding_headers_does_not_lift_the_hourly_cap(
    client: TestClient, db: Session, clock: list[float]
) -> None:
    # Only CF-Connecting-IP is trusted (Cloudflare overwrites it); X-Forwarded-For is ignored.
    configure(contact_click_limit_per_minute=1000)
    sources = ["product_detail", "product_card", "contact_page", "unknown"]
    for i in range(40):
        client.post(URL, json={"source": sources[i % 4]},
                    headers={"cf-connecting-ip": "203.0.113.77", "x-forwarded-for": f"198.51.100.{i}"})
        clock[0] += 31  # never a repeat
    assert rows(db) == get_settings().contact_click_client_limit_per_hour


def test_hourly_caps_recover_after_an_hour(client: TestClient, db: Session, clock: list[float]) -> None:
    configure(client_ip_header="cf-connecting-ip", contact_click_client_limit_per_hour=2)
    sources = ["product_detail", "product_card", "contact_page"]
    codes = [click(client, "203.0.113.8", {"source": source}) for source in sources]
    assert codes == [202, 202, 429]
    clock[0] += 3601
    assert click(client, "203.0.113.8", {"source": "contact_page"}) == 202


def test_a_restart_forgets_every_count(client: TestClient, db: Session, clock: list[float]) -> None:
    # In-memory limits (one Render worker): a restart or spin-down starts every window afresh.
    # Accepted: at most one more hourly quota per restart; stored clicks are unaffected.
    configure(client_ip_header="cf-connecting-ip", contact_click_global_limit_per_hour=1)
    assert [click(client, "203.0.113.1"), click(client, "203.0.113.2")] == [202, 429]
    for limiter in vars(rate_limit).values():
        if isinstance(limiter, rate_limit.FixedWindowRateLimiter):
            limiter._entries.clear()  # what a new process starts with
    assert click(client, "203.0.113.2") == 202
    assert rows(db) == 2


def test_concurrent_visitors_never_exceed_the_caps() -> None:
    stored: list[str] = []
    barrier = threading.Barrier(60)

    def visit(n: int) -> None:
        barrier.wait()
        visitor = f"v{n % 6}"  # 6 visitors x 10 distinct clicks, all at once
        try:
            with rate_limit.contact_click_quota(visitor, f"{visitor}|{n}", per_hour=4,
                                                global_per_hour=15, repeat_seconds=30):
                stored.append(visitor)
        except rate_limit.ContactQuotaExceeded:
            pass

    threads = [threading.Thread(target=visit, args=(n,)) for n in range(60)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(stored) == 15  # the site-wide cap, never more
    assert max(stored.count(f"v{i}") for i in range(6)) <= 4  # nobody over their own cap


def test_contact_limiters_are_bounded() -> None:
    limiters = [value for value in vars(rate_limit).values()
                if isinstance(value, rate_limit.FixedWindowRateLimiter)]
    assert len(limiters) >= 4 and all(limiter._max_keys <= 10_000 for limiter in limiters)


def quota(client: str, click: str, **limits: int):  # type: ignore[no-untyped-def]
    return rate_limit.contact_click_quota(
        client, click, **{"per_hour": 20, "global_per_hour": 1, "repeat_seconds": 30, **limits}
    )


def test_a_refusal_during_a_failed_store_leaves_the_quota_free(clock: list[float]) -> None:
    # Codex: A holds the only global slot, B is refused meanwhile, A's insert fails, then C.
    with pytest.raises(RuntimeError), quota("a", "a|1"):
        with pytest.raises(rate_limit.ContactQuotaExceeded), quota("b", "b|1"):
            pass
        raise RuntimeError("insert failed")
    with quota("c", "c|1"):  # the slot is free again: nothing was stored
        pass


def test_any_storage_failure_gives_the_quota_back(
    client: TestClient, db: Session, clock: list[float], monkeypatch: pytest.MonkeyPatch
) -> None:
    from sqlalchemy.exc import OperationalError

    configure(client_ip_header="cf-connecting-ip", contact_click_global_limit_per_hour=1)
    real_commit = type(db).commit
    failures = [OperationalError("commit", {}, Exception("connection lost"))]

    def flaky_commit(self: Session) -> None:
        if failures:
            raise failures.pop()
        real_commit(self)

    monkeypatch.setattr(type(db), "commit", flaky_commit)
    assert click(client, "203.0.113.4") == 500  # not an IntegrityError: a server error
    db.rollback()
    # Same visitor, same click, at once: neither a repeat nor over any cap.
    assert client.post(URL, json={}, headers={"cf-connecting-ip": "203.0.113.4"}).json() == {"accepted": True}
    assert rows(db) == 1


def test_a_late_give_back_never_credits_a_newer_window(clock: list[float]) -> None:
    limiter = rate_limit.FixedWindowRateLimiter()
    assert limiter.retry_after("k", 1, 60) is None
    admitted_at = rate_limit.time.monotonic()
    clock[0] += 61
    assert limiter.retry_after("k", 1, 60) is None  # new window, its one use taken
    limiter.release("k", admitted_at)  # the old window's use comes back too late
    assert limiter.retry_after("k", 1, 60) is not None  # the new window is still full


def test_refused_requests_are_not_counted(clock: list[float]) -> None:
    limiter = rate_limit.FixedWindowRateLimiter()
    assert limiter.retry_after("k", 1, 60) is None
    admitted_at = rate_limit.time.monotonic()
    for _ in range(5):
        assert limiter.retry_after("k", 1, 60) is not None
    limiter.release("k", admitted_at)
    assert limiter.retry_after("k", 1, 60) is None


def test_a_visitor_can_never_be_allowed_the_whole_site_quota() -> None:
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError, match="must be below"):
        Settings(contact_click_client_limit_per_hour=300, contact_click_global_limit_per_hour=300)
    assert Settings().contact_click_client_limit_per_hour < Settings().contact_click_global_limit_per_hour
