
from app.core.logging import configure_logging

# Configure redaction before importing any module that can validate settings or
# construct the database engine. Startup failures must use the safe formatter.
configure_logging()
