from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from ..services.nasa_power import ProviderError
from ..services.nasa_soil import fetch_soil
from ..soil_schemas import SoilQuery, SoilResponse
from .series import LAST_COMPLETE_YEAR


router = APIRouter(prefix="/api", tags=["Root-zone soil wetness"])


@router.get("/soil", response_model=SoilResponse,
            responses={503: {"description": "NASA soil wetness and its original-response cache are unavailable"}})
async def get_soil(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    start: Annotated[int, Query(ge=1981, le=LAST_COMPLETE_YEAR)] = 1981,
    end: Annotated[int, Query(ge=1981, le=LAST_COMPLETE_YEAR)] = LAST_COMPLETE_YEAR,
    refresh: bool = False,
) -> SoilResponse:
    if start > end:
        raise HTTPException(status_code=422, detail="Start year must not exceed end year.")
    try:
        return await fetch_soil(SoilQuery(latitude=lat, longitude=lon, start=start, end=end), refresh=refresh)
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
