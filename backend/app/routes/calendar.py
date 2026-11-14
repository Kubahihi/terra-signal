from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from ..schemas import CalendarResponse, SeriesQuery, Variable
from ..services.calendar_analysis import BASELINE_END, BASELINE_START, build_calendar
from ..services.nasa_power import ProviderError, fetch_monthly_series
from .series import LAST_COMPLETE_YEAR

router = APIRouter(prefix="/api", tags=["Calendar investigations"])


@router.get("/calendar", response_model=CalendarResponse)
async def get_calendar(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    variable: Variable = Variable.TEMPERATURE,
    start: Annotated[int, Query(ge=1981, le=LAST_COMPLETE_YEAR)] = 1981,
    end: Annotated[int, Query(ge=1981, le=LAST_COMPLETE_YEAR)] = LAST_COMPLETE_YEAR,
    refresh: bool = False,
) -> CalendarResponse:
    if start > end:
        raise HTTPException(status_code=422, detail="Start year must not exceed end year.")
    temperature = variable == Variable.TEMPERATURE
    # Fetch the fixed reference and the previous December, even for a short view.
    query = SeriesQuery(
        latitude=lat, longitude=lon, variable=variable,
        start=max(1981, min(start - 1, BASELINE_START) if temperature else start - 1),
        end=max(end, BASELINE_END) if temperature else end,
    )
    try:
        source = await fetch_monthly_series(query, refresh=refresh)
        return build_calendar(source, start, end)
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
