# NYC 311 Dispatch

A Next.js tool combining real NYC 311 reports, simulated infrastructure incidents and simulated crews. Dispatch scores jobs, respects crew specialties and shifts, and uses greedy nearest-neighbor routing. Incident intake can use an installed local Ollama model; every proposal remains editable and requires operator review.

## Run

```sh
npm ci
npm run dev
```

Open http://localhost:3000. `npm run check` exercises report handling, dispatch, road routing, responsibility metrics and AI input/output validation. `npm run build` builds the Next.js application; `npm start` serves the production build. A Node.js server is required for local AI intake; this version is not a static export.

## Road routing

Road mode is the default. Click **Run dispatch** to fetch Mapbox driving-time and distance matrices, assign the highest-priority jobs, and draw actual road geometry with estimated arrival offsets.

- Greedy selection uses directed driving time, so one-way streets and different outbound/return routes matter.
- Matrix requests are split into blocks of at most 24 coordinates, within the driving API's 25-coordinate limit. Results are cached in browser memory for five minutes. There is no straight-line fallback for unreachable pairs.
- Every crew's route includes a return to its depot. Shift capacity includes travel and repair estimates. Final Directions travel times are checked again; work is removed with an explicit capacity reason if the final route would exceed the shift.
- Kilometers and route geometry in Road mode come from Mapbox Directions. Arrival offsets include preceding travel and repair time. The driving profile does not include live traffic, and ETAs remain estimates.
- Mapbox Matrix and Directions calls use the public token in `lib/config.js` and normal account API usage. Authorization, timeout and rate-limit errors are shown. No estimated plan is substituted silently.
- **Estimated** mode remains an explicit option. It uses Haversine tours and distance × 1.35 at 20 km/h. Those lines and times are labeled schematic estimates.

## Responsibility

The Responsibility tab shows repair jobs, assignments, simulated completions, waiting age and unassigned reasons by community board, used as a neighborhood proxy. Simulated incidents and missing board data are separate rows. Waiting age is measured at the source cutoff; scenario ages are simulated. Counts cover the currently loaded and filtered jobs, not the entire city.

The panel explicitly flags that complaint volume is reporting activity, not a direct measure of neighborhood need. Different access and willingness to report can affect counts. Coverage is not population-adjusted and does not establish fairness. Unassigned work includes unavailable specialties, shift/stop limits, unreachable road tours and jobs outside the selected top-job limit.

## Optional local AI intake

Open **Intake**, click **Add infrastructure incident**, and describe the problem. The tool checks Ollama at `127.0.0.1:11434` and lists installed local models. No cloud provider, cloud model, model download or API key is used. An optional `OLLAMA_MODEL` environment variable chooses an installed model; otherwise the first installed local model is selected.

1. Click **Analyze with local AI**. The description is processed locally with structured output.
2. Review the proposed title, specialty, severity and repair estimate, supporting quotes and uncertainties.
3. Click **Use proposal in editable form**, adjust the fields, and supply an address label, borough and coordinates (or pick a point on the map).
4. Click **Add to simulation**. Only then is a job added. The model never invents coordinates and cannot dispatch a crew.

A separately labeled **Rules suggestion** is available without a model. It is never presented as AI model output. Model responses are validated, exact supporting quotes are checked against the supplied description, and unsupported classifications require manual handling. Repair durations and severity remain proposals rather than verified facts.

## Dispatch simulation

Triage uses severity (1–5) × 16, up to 15 age points (one per four hours) and up to 15 repeated-report points (four per additional same-problem report at the same site). Critical begins at 80; high at 65; moderate at 40. Repeated-report age uses the oldest report. Scores and repair durations are demo estimates, not official city priorities.

Jobs are considered in descending priority. Compatible available crews are selected by the smallest added workload within shift and stop limits. Each crew repeatedly visits the nearest unvisited stop, using driving time in Road mode, then returns to its depot. This is an approximation, not an optimal TSP solver; lower-priority jobs may be visited first within a crew's selected tour.

Closed records and non-repair issues remain outside repair dispatch. Referral counts do not send referrals. Simulated completion never changes NYC source records. Reset the simulation before planning a fresh shift. Simulation state lives in browser memory and resets on reload.

## Sources and code

NYC reports come from https://data.cityofnewyork.us/d/erm2-nwe9. Each query checks up to 5,000 newest date-matched records in batches of 500, selecting fields used by the map, filters and dispatch panel. The map shows records with valid NYC coordinates and reports plotted-point and batch counts. Date windows end at the newest source request. Seed infrastructure incidents, depots, crew resources and repair durations are simulated.

- `lib/dispatch.mjs`: scoring, deduplication, assignment and greedy tours.
- `lib/road-routing.mjs`: Mapbox Matrix batching, road-time cost and Directions geometry.
- `lib/responsibility.mjs`: coverage and waiting metrics with explicit denominators.
- `lib/local-intake.mjs`, `lib/intake.mjs`, `app/api/intake/route.js`: local inference and validation.
- `components/operations-panel.js`: dispatch, crew, intake and simulation controls.
- `components/responsibility-panel.js`, `components/local-intake.js`: review and responsibility UI.
- `components/report-map.js`, `lib/reports.mjs`: real report loading and combined map layers.

The existing Sites project ID is preserved in `.openai/hosting.json`; the former static export configuration has been removed because local intake requires a Next.js server. This work runs locally on port 3000. No real crews are dispatched.
