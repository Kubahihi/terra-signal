"""NASA POWER root-zone soil wetness response, separate from air-weather series."""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .schemas import Observation


class SoilQuery(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    start: int = Field(ge=1981)
    end: int = Field(ge=1981)

    @model_validator(mode="after")
    def validate_interval(self):
        if self.start > self.end or self.end >= datetime.now(timezone.utc).year:
            raise ValueError("Choose an ordered interval of complete calendar years from 1981.")
        return self


class SoilResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    latitude: float
    longitude: float
    start: int
    end: int
    parameter: Literal["GWETROOT"] = "GWETROOT"
    unit: Literal["1"] = "1"
    series: list[Observation]
    source: str
    source_url: str
    retrieved_at: str
    data_origin: Literal["live", "cache"]
    warnings: list[str]
