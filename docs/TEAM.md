# First working version

## Ownership

| Person | Owns | First acceptance check |
| --- | --- | --- |
| Jakub | `frontend/`, interaction, integration, deployment | Select a location and render a real API time series, with loading/error states |
| Matej | `backend/`, NASA provider, normalization, analysis implementation | Real ordered monthly data with verified units and missing-value handling |
| Terka | Scientific method, independent calculations, interpretation | Check reference slopes, seasonality, uncertainty, missing dates, and honest conclusions |

Agree on changes to `docs/API.md` and the corresponding models before changing
the response format. Use separate branches. Integrate small changes regularly.

## Milestones

1. Backend health appears in the frontend; setup works for both programmers.
2. Matej replaces the explicit 501 provider stub with a real NASA time series.
3. Jakub verifies the graph against those same observations.
4. Terka and Matej select, implement, and independently check a trend method.
5. Connect validated analysis results to the existing result cards.
6. Verify two reproducible real examples, coverage warnings, and source references.
7. Deploy, check public access, complete the project description and demo.

## Remaining setup

- Ensure Matej has accepted the GitHub collaborator invitation and can clone/push.
- Install the project's own Python and frontend dependencies on each computer.
- Choose one hosting provider/account. Use the provider's HTTPS URL for the demo;
  a custom domain is optional and currently unclaimed.
- Keep source credentials on the backend. `VITE_` values are public browser config.
- Record dataset versions, references, licenses, and AI assistance while working.
- Verify the final site and demo links without a login before submission.

The current scaffold has no database, account system, or implemented statistical
test. Add them only if the agreed scope needs them. Do not present pending work
as completed science.
