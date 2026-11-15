from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from ..schemas import DailyPeriodsResponse, DailyQuery, DailyResponse, DailyTrendRequest, DailyTrendsResponse
from ..services.nasa_daily import fetch_daily
from ..services.daily_trends import analyze_daily_trends
from ..services.daily_periods import analyze_daily_periods
from ..services.nasa_power import ProviderError
from .series import LAST_COMPLETE_YEAR

router = APIRouter(prefix="/api", tags=["Daily weather indices"])


@router.post("/daily/periods", response_model=DailyPeriodsResponse)
def daily_periods(request: DailyTrendRequest) -> DailyPeriodsResponse:
    """Compare prespecified subsets of the caller's complete annual indices."""
    return analyze_daily_periods(request)


@router.post("/daily/trends", response_model=DailyTrendsResponse)
def daily_trends(request: DailyTrendRequest) -> DailyTrendsResponse:
    """Analyze the complete annual values assembled from daily batches; no refetch."""
    return analyze_daily_trends(request)


@router.get("/daily", response_model=DailyResponse,
            responses={503: {"description": "NASA daily data and daily cache are unavailable"}})
async def get_daily(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    start: Annotated[int, Query(ge=1981, le=LAST_COMPLETE_YEAR)] = LAST_COMPLETE_YEAR,
    end: Annotated[int, Query(ge=1981, le=LAST_COMPLETE_YEAR)] = LAST_COMPLETE_YEAR,
    refresh: bool = False,
) -> DailyResponse:
    if start > end or end - start > 4:
        raise HTTPException(status_code=422, detail="Request one to five whole years per daily batch.")
    try:
        return await fetch_daily(DailyQuery(latitude=lat, longitude=lon, start=start, end=end), refresh=refresh)
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
