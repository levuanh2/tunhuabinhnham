from pathlib import Path

from sqlalchemy import create_engine

from app.core.config import get_settings

path = Path(__file__).resolve().parents[3] / "supabase" / "seed.sql"
engine = create_engine(get_settings().database_url)
with engine.begin() as connection:
    connection.exec_driver_sql(path.read_text(encoding="utf-8"))
print("Seed completed")
