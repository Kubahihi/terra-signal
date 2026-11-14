# API contract

Backend models: `backend/app/schemas.py`. Browser types: `frontend/src/types/api.ts`.
Update both when changing this contract. Frontend owns presentation; backend owns
data cleaning, units, aggregation, and statistical results.

## Available now

- `GET /health` and `GET /api/health`: service status, name, version.
- `GET /docs`: interactive OpenAPI documentation.
- `GET /api/series`: validates the request, then returns **501** until the NASA
  provider is implemented. This is an explicit unfinished integration, not a
  simulated scientific result.

Example request:

```text
/api/series?lat=50.0755&lon=14.4378&variable=T2M&start=1981&end=2025
```

`lat`: -90 to 90; `lon`: -180 to 180; `variable`: `T2M` or `PRECTOTCORR`;
`start` and `end`: 1981 through the previous complete year, `start <= end`.
These are project request limits; they do not guarantee that every NASA variable
has complete coverage throughout the requested interval.

## Successful response

| Field | Meaning |
| --- | --- |
| `source` | Human-readable source, including dataset/version where available |
| `variable` | NASA parameter identifier |
| `unit` | Actual units from provider metadata |
| `latitude`, `longitude` | Requested point coordinates |
| `start`, `end` | Requested year range |
| `series` | Ordered monthly `{date: "YYYY-MM-01", value: number or null}` records |
| `warnings` | Human-readable data-quality and coverage limitations |
| `analysis` | `null` until the statistical method is implemented and checked |

When implemented, `analysis` contains `method`, `slope_per_year`,
`slope_per_decade`, `ci95_per_decade` (two bounds or null), and `p_value` (or null).
The confidence interval refers to **the slope per decade**, not individual
observations or a forecast interval. Undefined statistics must be null, never NaN.

## Matej: implement the NASA provider

Implement `fetch_monthly_series()` in `backend/app/services/nasa_power.py`:

1. Request `NASA_POWER_URL` from config, with the requested point, parameter,
   start/end years, community, and JSON format. Use a bounded timeout.
2. Preserve the source metadata and retrieve units and missing-value marker.
3. Accept monthly keys ending in 01-12. Do not parse an annual aggregate as month 13.
4. Normalize missing/non-finite observations to null, preserve gaps, sort dates.
5. Report actual coverage and distinguish a model grid cell from a weather station.
6. Handle provider errors without returning fabricated data or exposing credentials.
7. Return `analysis: null` until Terka has checked the implementation.

Reference: https://power.larc.nasa.gov/docs/services/api/temporal/monthly/

## Local connection

The browser calls `/api/*`. Vite forwards these requests to `127.0.0.1:8000`.
For separate production hosts, set `VITE_API_BASE_URL` at frontend build time and
allow the exact frontend origin in backend `CORS_ORIGINS`.
