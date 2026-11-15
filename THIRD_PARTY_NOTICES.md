# Third-party notices and data sources

TerraSignal's original code is licensed under Apache-2.0; see [LICENSE](LICENSE).
That license does not replace the licenses or terms of third-party libraries,
NASA records, map data, external services, or their trademarks. The notices
below identify the dependencies and sources checked for this release; they are
not a complete legal audit of every component or deployment environment.

## Browser distribution

The browser bundle uses Leaflet, React, React DOM, and React DOM's Scheduler
dependency. An in-memory production build with the installed lockfile also
identified Vite's module-preload polyfill and preload helper, and the generated
CommonJS helper. No other npm packages appeared in the emitted browser chunks.

[frontend/public/third-party-licenses.txt](frontend/public/third-party-licenses.txt)
contains the full original license texts of those four runtime packages,
Vite's core MIT license, and the original Rollup plugins MIT notice containing
`@rollup/plugin-commonjs`, as supplied in the installed Vite package. Vite copies
this public file to the site root as `/third-party-licenses.txt` during the
frontend build. Keep it with redistributed browser assets.

Versions and license identifiers below come from `frontend/package-lock.json`
and the corresponding installed `package.json` files.

| Package | Locked version | Role | Declared license |
| --- | --- | --- | --- |
| leaflet | 1.9.4 | Map runtime | BSD-2-Clause |
| react | 19.3.1 | UI runtime | MIT |
| react-dom | 19.3.1 | Browser rendering runtime | MIT |
| scheduler | 0.28.0 | Transitive runtime dependency of react-dom | MIT |
| @types/leaflet | 1.9.21 | Development types | MIT |
| @types/node | 22.20.5 | Development types | MIT |
| @types/react | 19.3.0 | Development types | MIT |
| @types/react-dom | 19.3.0 | Development types | MIT |
| @vitejs/plugin-react | 5.2.0 | Development/build tool | MIT |
| typescript | 5.9.3 | Development/build tool | Apache-2.0 |
| vite | 7.3.7 | Development/build tool; generated browser helpers | MIT |

This table includes all direct frontend dependencies and development tools,
plus the transitive browser runtime package. It does not enumerate every
transitive build tool. Their versions and declared licenses are recorded in
`frontend/package-lock.json`; retain the original notices shipped in their
packages when redistributing those tools. Upstream sources:
[Leaflet](https://github.com/Leaflet/Leaflet),
[React, React DOM and Scheduler](https://github.com/facebook/react),
[DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped),
[TypeScript](https://github.com/microsoft/TypeScript),
[Vite](https://github.com/vitejs/vite),
[Vite React plugin](https://github.com/vitejs/vite-plugin-react), and
[Rollup plugins](https://github.com/rollup/plugins).

## Python distribution

All entries in `backend/requirements.lock.txt` are listed below. Installed
versions were checked against the lockfile. SPDX expressions are reproduced
from installed distribution metadata where supplied; legacy license labels or
license text descriptions are identified explicitly.

| Package | Locked version | License from installed metadata / supplied notices |
| --- | --- | --- |
| annotated-doc | 0.0.6 | MIT |
| annotated-types | 0.8.0 | MIT |
| anyio | 4.16.0 | MIT |
| certifi | 2026.10.23 | MPL-2.0 |
| click | 8.5.1 | BSD-3-Clause |
| fastapi | 0.162.7 | MIT |
| formulaic | 1.2.2 | MIT |
| h11 | 0.16.0 | MIT |
| httpcore | 1.0.9 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| idna | 3.20 | BSD-3-Clause |
| interface_meta | 2.0.1 | MIT |
| narwhals | 2.28.0 | MIT |
| numpy | 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| opentelemetry-api | 1.45.2 | Apache-2.0 |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| pandas | 3.1.1 | BSD-3-Clause; additional bundled-component notices supplied with package |
| patsy | 1.0.3 | "2-clause BSD" (legacy metadata); supplied license also includes Python Software Foundation License Version 2 for `patsy.compat` |
| pydantic | 2.14.3 | MIT |
| pydantic_core | 2.50.4 | MIT |
| python-dateutil | 4.0.0 | BSD-3-Clause |
| scipy | 1.18.1 | BSD 3-clause license text in metadata; additional bundled-component licenses supplied with wheel |
| starlette | 1.10.0 | BSD-3-Clause |
| statsmodels | 0.15.0 | BSD-3-Clause; additional subcomponent notices supplied with package |
| typing-inspection | 0.4.5 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| tzdata | 2026.6 | Apache-2.0 (legacy License metadata) |
| uvicorn | 0.54.0 | BSD-3-Clause |
| wrapt | 2.5.2 | BSD-2-Clause |

The original license files remain part of the installed Python packages. The
Dockerfile installs this lockfile with `pip` and does not remove those files.
Look under the environment's `site-packages/*-<version>.dist-info/licenses/`
directories; SciPy's main notice is at
`scipy-1.18.1.dist-info/LICENSE.txt`. Some packages also keep component notices
inside their package directories. `python -m pip show -f PACKAGE` lists the
installed files, including license paths. Local development uses
`.venv/Lib/site-packages`; the Python 3.12 container normally uses
`/usr/local/lib/python3.12/site-packages`.

Retain the full installed notices when redistributing Python environments or
container images. A primary package license in the table does not replace its
bundled-component notices. For example, the inspected SciPy Windows wheel's
notice covers OpenBLAS, LAPACK, and a GCC runtime under
`GPL-3.0-or-later WITH GCC-exception-3.1`; the supplied license explains the
exception. Binary components and notices can differ between Windows and Linux
wheels. NumPy, pandas, Patsy and statsmodels also supply component-specific
license texts. Consult the actual installed distribution for the target
platform rather than applying the project's Apache license to those files.

Package metadata and original notices can also be obtained from the matching
versioned distributions on [PyPI](https://pypi.org/).

## NASA POWER environmental records

NASA Langley Research Center's Prediction Of Worldwide Energy Resources
(POWER) project, supported by NASA's Earth Science Division, provided the POWER
environmental records used by TerraSignal. Meteorological and soil-wetness
records use the MERRA-2 source chain through POWER. NASA does not endorse
TerraSignal.

TerraSignal uses the POWER Monthly and Annual API and Daily API. Cite the
service name, its response-reported version and the actual access date when
using or publishing records. The bundled original monthly snapshots report
POWER Monthly and Annual API `v2.10.0`, accessed on 2026-11-14; their exact
requests, retrieval timestamps and checksums are in
`backend/data/snapshots/index.json`. Other saved analyses and live exports
retain their own source requests and retrieval metadata; do not substitute
the snapshot date for those records.

Sources: [POWER Referencing Guide](https://power.larc.nasa.gov/docs/referencing/),
[Monthly API](https://power.larc.nasa.gov/docs/services/api/temporal/monthly/),
[Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/),
[meteorological sources](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/),
and [hydrology sources](https://power.larc.nasa.gov/docs/methodology/data/sources_hydrology/).
POWER requests notification of publications and redistribution to support
its service; its Referencing Guide provides the details.

## NASA MODIS vegetation records and access services

TerraSignal uses the Terra MODIS MOD13Q1 Collection 6.1 NDVI and pixel-reliability
product. Recommended dataset citation:

Didan, K. (2021). *MODIS/Terra Vegetation Indices 16-Day L3 Global 250m SIN Grid
V061* [Data set]. NASA EOSDIS Land Processes DAAC.
[https://doi.org/10.5067/MODIS/MOD13Q1.061](https://doi.org/10.5067/MODIS/MOD13Q1.061).
Add the access date applicable to the records used.

The [LP DAAC data-citation FAQ](https://forum.earthdata.nasa.gov/viewtopic.php?t=6891)
states that its current data and products have no restrictions on reuse,
sale or redistribution, and requests appropriate citation. These NASA data
retain their own provenance and are not relicensed by TerraSignal.

The primary live access service is Microsoft Planetary Computer's
[`modis-13Q1-061` STAC collection](https://planetarycomputer.microsoft.com/api/stac/v1/collections/modis-13Q1-061).
The collection currently labels its license `proprietary`, so this notice does
not assert that all Microsoft-hosted assets or services are Apache-2.0 or CC0.
Distinguish NASA's source-data terms from Microsoft's
[service terms](https://planetarycomputer.microsoft.com/terms) and
[access-token rules](https://planetarycomputer.microsoft.com/docs/concepts/sas/).
In particular, service access tokens are not licensed for public redistribution.
Preserve original source metadata and check terms for the actual asset used.

The optional user-import path accepts ORNL DAAC MODIS subset exports:
[ORNL MODIS service](https://modis.ornl.gov/) and
[export documentation](https://modis.ornl.gov/documentation.html).
Imported records remain labelled as user-supplied, with their supplied
provenance; TerraSignal does not certify their origin or change their terms.

## OpenStreetMap basemap

Map data is copyright OpenStreetMap contributors and available under the
[Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
See [OpenStreetMap's copyright and license page](https://www.openstreetmap.org/copyright).
The basemap is separate from NASA environmental observations and the
TerraSignal source-code license.

The app requests standard raster tiles from `https://tile.openstreetmap.org`.
Their operation is governed by the
[OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/),
separately from the data license. Keep visible map attribution and the
copyright/license link, including when sharing screenshots or demos; respect
the service's caching, identification, and usage limits. Do not use it for bulk
or offline tile downloading. A larger deployment may require another tile
provider or self-hosting. Leaflet's software license is included in the browser
license file above.
