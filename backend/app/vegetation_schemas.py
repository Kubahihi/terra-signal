"""MODIS vegetation contract, separate from the NASA POWER weather contract."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class VegetationQuery(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    start: int = Field(ge=2001)
    end: int = Field(ge=2001)


class VegetationObservation(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    date: date
    value: float | None
    available_composites: int
    expected_composites: int


class VegetationSource(BaseModel):
    source_url: str
    retrieved_at: str
    data_origin: Literal["live", "cache"]


class VegetationResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    latitude: float
    longitude: float
    start: int
    end: int
    product: Literal["MOD13Q1"] = "MOD13Q1"
    unit: Literal["NDVI"] = "NDVI"
    series: list[VegetationObservation]
    spatial_support: str
    pixel_size_m: float
    nrows: int
    ncols: int
    collections: list[str]
    source: str
    source_url: str
    sources: list[VegetationSource]
    retrieved_at: str
    data_origin: Literal["live", "cache"]
    warnings: list[str]
