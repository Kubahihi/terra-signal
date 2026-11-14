"""Run from the repository root: python -m uvicorn backend.app.main:app --reload."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import CORS_ORIGINS, PROJECT_ROOT
from .routes.series import router as series_router

app = FastAPI(
    title="TerraSignal API",
    version="0.1.0",
    description="Explore NASA Earth data, detect trends, and understand uncertainty.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["Accept", "Content-Type"],
)


@app.get("/health", tags=["Status"])
@app.get("/api/health", tags=["Status"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "terra-signal", "version": "0.1.0"}


app.include_router(series_router)

# A production build can be served by the same app, without a second hostname.
frontend_build = PROJECT_ROOT / "frontend" / "dist"
if frontend_build.is_dir():
    app.mount("/", StaticFiles(directory=frontend_build, html=True), name="frontend")
