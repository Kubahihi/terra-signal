# Original NASA POWER responses

`prague.json` and `medicine-hat.json` are unmodified JSON response objects fetched
from the public NASA POWER API for T2M and PRECTOTCORR, 1981-2025. Only formatting
(indentation and a trailing newline) was applied when saving the objects.

`index.json` records the exact coordinates, requested interval, source URL,
UTC retrieval time, and SHA-256 of each saved file. These are real data snapshots
for a reproducible demo and explicit outage fallback, not simulated observations.

The NASA payloads include monthly values and annual summary values. The provider
normalizer excludes annual summaries and only returns the requested monthly range.

Source and documentation: https://power.larc.nasa.gov/docs/
