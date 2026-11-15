from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from ..services.planetary_ndvi import fetch_vegetation
from ..services.nasa_power import ProviderError
from ..vegetation_schemas import VegetationQuery, VegetationResponse
from .series import LAST_COMPLETE_YEAR

router = APIRouter(prefix="/api", tags=["Satellite vegetation"])


@router.get("/vegetation", response_model=VegetationResponse,
            responses={503: {"description": "Numeric MODIS data and a matching saved response are unavailable"}})
async def get_vegetation(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    start: Annotated[int, Query(ge=2001, le=LAST_COMPLETE_YEAR)] = 2021,
    end: Annotated[int, Query(ge=2001, le=LAST_COMPLETE_YEAR)] = LAST_COMPLETE_YEAR,
    refresh: bool = False,
) -> VegetationResponse:
    if start > end or end - start > 4:
        raise HTTPException(status_code=422, detail="Request one to five complete MODIS calendar years from 2001.")
    try:
        return await fetch_vegetation(VegetationQuery(latitude=lat, longitude=lon, start=start, end=end), refresh)
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
