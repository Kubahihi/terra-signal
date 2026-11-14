"""NASA POWER integration entry point, owned by Matej.

Implementation checklist and the response contract are in docs/API.md.
This starter deliberately returns no invented observations or trend results.
"""

from ..schemas import SeriesQuery, SeriesResponse


class ProviderNotReadyError(RuntimeError):
    """The NASA data connection has not been implemented yet."""


async def fetch_monthly_series(query: SeriesQuery) -> SeriesResponse:
    """Fetch, normalize and describe a real monthly NASA POWER time series."""
    raise ProviderNotReadyError(
        "The NASA data connection is not ready yet. No analysis was calculated."
    )
