from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()


def _create_engine() -> Engine:
    options: dict[str, object] = {"pool_pre_ping": True}
    if settings.database_url.startswith("postgresql"):
        connect_args: dict[str, object] = {
            "connect_timeout": settings.db_connect_timeout_seconds,
            "sslmode": "require",
            "application_name": "tunhuabinhnham-api",
        }
        if settings.db_disable_prepared_statements:
            connect_args["prepare_threshold"] = None
        options.update(
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_timeout=settings.db_pool_timeout_seconds,
            pool_recycle=300,
            connect_args=connect_args,
        )
    return create_engine(settings.database_url, **options)


engine = _create_engine()
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        try:
            yield session
        except Exception:
            session.rollback()
            raise
