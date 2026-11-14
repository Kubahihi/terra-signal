"""Small environment-based configuration shared by the app and its services."""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]
