from sqlalchemy import create_engine, text

from app.core.config import get_settings


def main() -> None:
    engine = create_engine(get_settings().database_url, pool_pre_ping=True)
    with engine.connect() as connection:
        database, user = connection.execute(text("select current_database(), current_user")).one()
        tables: list[str] = list(connection.execute(
            text(
                "select table_name from information_schema.tables "
                "where table_schema = 'public' order by table_name"
            )
        ).scalars().all())
        print(f"Connected database={database} user={user}")
        print(f"Public tables ({len(tables)}): {', '.join(tables) if tables else '(none)'}")
    engine.dispose()


if __name__ == "__main__":
    main()
