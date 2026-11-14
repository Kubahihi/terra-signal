from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from ..schemas import SeriesQuery, SeriesResponse, Variable
from ..services.nasa_power import ProviderNotReadyError, fetch_monthly_series

router = APIRouter(prefix="/api", tags=["Earth data"])
LAST_COMPLETE_YEAR = datetime.now(timezone.utc).year - 1


@router.get(
    "/series",
    response_model=SeriesResponse,
    responses={501: {"description": "NASA data provider is not implemented yet"}},
)
async def get_series(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    variable: Variable = Variable.TEMPERATURE,
    start: Annotated[int, Query(ge=1981, le=LAST_COMPLETE_YEAR)] = 1981,
    end: Annotated[int, Query(ge=1981, le=LAST_COMPLETE_YEAR)] = LAST_COMPLETE_YEAR,
) -> SeriesResponse:
    if start > end:
        raise HTTPException(status_code=422, detail="Start year must not exceed end year.")

    query = SeriesQuery(
        latitude=lat, longitude=lon, variable=variable, start=start, end=end
    )
    try:
        return await fetch_monthly_series(query)
    except ProviderNotReadyError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
