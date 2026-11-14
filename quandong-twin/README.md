# Quandong Cyber OT digital twin

A working demo of managed security monitoring for operational technology (OT). **Quandong Cyber** and its
customer **Murray Flats Water**, a regional water utility, are fictional. Every site, asset, user, vendor and
value here is synthetic. Nothing in this repository connects to real industrial equipment.

The demo has two halves:

1. **Generator (Cloudflare Workers, Free plan).** One Durable Object per pump station simulates the
   process minute by minute and produces seven event feeds. They are pushed, as newline-delimited JSON
   (NDJSON), into a Databricks Unity Catalog volume through the Databricks Files API.
2. **Lakehouse (Databricks Free Edition).** A Declarative Automation Bundle (formerly Databricks Asset
   Bundles, DABs) with **one** Lakeflow Spark Declarative Pipeline running bronze → silver → gold. Gold holds
   rule-based detections, incidents, site health, compliance status and a scorecard against the planted
   incidents. A paused refresh job and an AI/BI dashboard are included.

Cloudflare **pushes** into Databricks; Databricks never calls out to the internet.

> This folder lives inside a repository that also holds an unrelated website (the root `README.md`,
> `wrangler.jsonc`, `src/`). Everything for the twin is in `quandong-twin/`. It has its own
> `package.json` and Wrangler config, so it never touches the site's build or deploy.

---

## Contents

- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Quick start (offline, no accounts needed)](#quick-start-offline-no-accounts-needed)
- [Data contracts and the seven feeds](#data-contracts-and-the-seven-feeds)
- [Simulation](#simulation)
- [Incident scenarios](#incident-scenarios)
- [Detections](#detections)
- [Setting up Databricks Free Edition](#setting-up-databricks-free-edition)
- [Setting up Cloudflare](#setting-up-cloudflare)
- [Triggering a scenario](#triggering-a-scenario)
- [Cost and quota arithmetic](#cost-and-quota-arithmetic)
- [Configuration reference](#configuration-reference)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Changes from the original brief](#changes-from-the-original-brief)

---

## Architecture

```
Cloudflare (Workers Free)                                  Databricks Free Edition
──────────────────────────                                 ─────────────────────────────────────────────
SiteTwin Durable Object × (PS01…PS05 + HO)                 /Volumes/workspace/quandong_twin/landing/
  alarm every TICK_MINUTES (1 min)                           {feed}/date=YYYY-MM-DD/{site}_{window_ms}.jsonl
   ├─ advance physics (pumps, flow, pressure,                _ground_truth/scenario_log/…   (restricted)
   │   chlorine, reservoir)                                          │
   ├─ build events for 7 feeds (+ scenario steps)                    ▼  Auto Loader (cloudFiles, JSON)
   └─ append ONE outbox row per alarm (SQLite)             bronze_{stream}   raw + _rescued_data, _ingested_at, _source_file
                                                                     │
Cron Worker (*/5 * * * *)                                            ▼  contract types, dedup, expectations
   └─ RPC flush() to every site's Durable Object ──PUT──▶  silver_{stream}  (+ silver_remote_sessions)
        each object PUTs its complete 5-minute windows               │
        (Files API 2.0, overwrite=false, retry + backoff)             ▼  materialised views
                                                           gold_detections · gold_incidents · gold_site_health
Scenario API  POST /scenarios/{name}?site=PS03             gold_compliance_status · gold_detection_scorecard
                                                                     │
                                                           Job (every 30 min, deployed PAUSED) · AI/BI dashboard
```

At-least-once delivery works like this. A window's outbox rows are deleted only after **every** file for
that window has been accepted. File names are deterministic and their bytes are identical on every retry,
so a retry that finds the file already there (409) counts as success. Nothing is duplicated and nothing is
lost.

## Repository layout

```
quandong-twin/
  contracts/                  ODCS v3.2.0 contracts: the single source of truth for schemas
    *.odcs.yaml               7 feeds + scenario_log (restricted)
    common.yaml               envelope fields every contract repeats (drift is checked)
    reference/ot_reference.yaml  bands, business hours, change window, detection rule catalogue
    generated/jsonschema/     generated JSON Schemas (used by contract tests)
    vendor/                   official ODCS v3.2.0 JSON Schema
  generator/                  Cloudflare Worker (TypeScript, strict)
    wrangler.jsonc  .dev.vars.example  vitest.workers.config.ts
    src/
      index.ts                fetch (scenario API, status, local debug) + scheduled (flush fan-out)
      site.ts                 SiteTwin Durable Object (SQLite backend, alarms)
      engine.ts               Cloudflare-free simulation engine: outbox, windows, flush
      store.ts sqlite-store.ts  storage abstraction (memory for tests, SQLite in the object)
      config.ts env.ts
      contracts/              generated types and reference values (do not edit)
      model/                  sites, assets, physics, daily plans, seeded RNG, time, IDs
      feeds/                  one event builder per feed
      scenarios/              rogue_setpoint, rogue_device, unauthorised_logic_change
      sink/                   Databricks Files API client with retry, backoff and budget
    test/                     Vitest unit tests; test/workers/ runs inside workerd
  lakehouse/                  Databricks bundle
    databricks.yml  pyproject.toml
    resources/                storage (schema + volume), pipeline, job, dashboard
    src/pipeline/             bronze.py silver.py gold.py (thin `dp` wiring)
    src/quandong/             plain PySpark logic: transforms, detections, incidents, health, scorecard
    src/dashboards/           quandong_ot.lvdash.json
    tests/                    pytest with local Spark (unit + end to end on generator output)
  scripts/                    codegen, smoke test, backfill, fake Files API, bundle validator
```

Compared with the suggested layout, I made three changes:

- **`engine.ts` sits apart from `site.ts`.** All the simulation logic runs without Cloudflare, so unit
  tests, the smoke test and the backfill script run exactly the code the Durable Object runs.
- **`src/quandong/` is a plain PySpark package beside `src/pipeline/`.** `pyspark.pipelines` only works
  inside a pipeline, so the logic sits outside the `dp` decorators, where it can be tested with small
  handcrafted DataFrames.
- **`contracts/reference/`** holds operational values (bands, windows, rule IDs) that both sides need.

## Quick start (offline, no accounts needed)

Requirements: Node.js 22.18 or later. For the lakehouse tests you also need Python 3.11+ and Java 17 or 21.

```bash
cd quandong-twin
```

```bash
npm install
```

```bash
npm run check          # contracts in sync, typecheck, lint, unit tests, bundle validation
```

```bash
npm run test:do        # Durable Object tests inside the Workers runtime
```

```bash
npm run smoke          # 2 simulated hours with rogue_setpoint → ./out/smoke, sequence verified
```

Run the Worker locally against a fake Files API that writes to `./out/`:

```bash
cp generator/.dev.vars.example generator/.dev.vars
```

```bash
npm run local-files-api        # terminal 1 (FAIL_RATE=0.2 injects 503s to watch the retries)
```

```bash
npm run dev                    # terminal 2: wrangler dev on http://localhost:8787
```

```bash
npm run smoke -- --wrangler http://localhost:8787   # terminal 3: drive it, then verify ./out
```

In local mode, `POST /debug/advance?site=PS03&minutes=120` simulates ahead of the clock and flushes.
Without it, the generator runs in real time: one simulated minute per minute.

Lakehouse tests:

```bash
cd lakehouse && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
```

```bash
.venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/python -m pytest -q
```

## Data contracts and the seven feeds

Each feed is an [Open Data Contract Standard](https://bitol-io.github.io/open-data-contract-standard/)
(ODCS) **v3.2.0** contract in `contracts/`. Running `npm run gen` validates every contract against the
official JSON Schema and generates:

- TypeScript event types, field lists and landing folders (`generator/src/contracts/generated.ts`)
- a JSON Schema per event (`contracts/generated/jsonschema/`), which every generated event is tested against
- Spark schema hints, column types and pipeline expectations (`lakehouse/src/quandong/contracts_generated.py`)

`npm run gen:check` fails if anything generated is out of date, so the two sides cannot drift apart.

Every event carries the envelope: `event_id` (deterministic UUID), `event_ts` (UTC, ISO 8601), `customer_id`,
`site_id`, `feed`, `schema_version`, `generator_run_id`.

| Feed | Grain | Main fields |
| --- | --- | --- |
| `asset_inventory` | snapshot at start and daily at 00:05; a row per change | asset_id, asset_type, vendor, model, firmware_version, logic_checksum, ip_address, mac_address, purdue_level, criticality, first_seen, last_seen, change_type |
| `network_flows` | per connection per minute | window_start/end, src/dst asset and IP, dst_port, transport, protocol, bytes, packets, direction, connection_state |
| `protocol_events` | per command (routine polls aggregated per minute) | asset_id, initiator_asset_id/ip, protocol, function_code, operation, register_or_point, old/new_value, user_context, command_count, result, logic_checksum_before/after, firmware_version |
| `process_telemetry` | per tag per minute | tag (e.g. `PS03.CL2.DOSE_MGL`), asset_id, value, unit, quality |
| `remote_access` | per session state change (rejected, started, ended) | session_id, session_state, username, user_type, source_ip, source_country, mfa_method, mfa_result, start_ts, end_ts, target_asset_id, protocol |
| `security_alerts` | per sensor detection (includes noise) | alert_id, rule_id, rule_name, severity, mitre_attack_ics_technique, asset_id, src_ip, description, status |
| `compliance_evidence` | per control per day (head office, 06:00) | framework (Essential Eight, CIRMP), control_id, control_name, maturity_level, status, evidence_ref, assessment_date, notes |
| `scenario_log` (restricted) | per scenario step | scenario_id, scenario_name, step, step_name, expected_rule_ids, evidence_event_ids, … |

**How contract quality rules become pipeline expectations:**

- `required`, `enum`, `pattern` and min/max values → `expect_or_drop`. These are structural failures, so
  the rows are dropped.
- `type: custom` rules with `engine: databricks-expectation` → `expect_or_drop` if `severity: error`, or
  `expect` (warn only) if `severity: warning`.
- Physical-range rules, such as chlorine outside 0.5–1.5 mg/L, are warnings. Those rows are kept because
  they may be attacks.

## Simulation

- **Sites:** `SITE_COUNT` pump stations (default 5, PS01–PS05, up to 40), plus head office `HO`. Each
  site's layout comes from its index in `generator/src/model/sites.ts`: 2 or 3 pumps, an engineering
  workstation on odd-numbered sites, and a reservoir sized 0.6–0.9 ML.
- **Assets:** 6–8 per site: 2–3 PLCs (programmable logic controllers), 1 RTU (remote terminal unit), 1 HMI
  (human–machine interface), 1 network switch, sometimes an engineering workstation. Head office has the
  historian and the SCADA (supervisory control and data acquisition) server. Addresses are private
  (`10.20.{site}.0/24`, head office `10.10.0.0/24`). External addresses come only from RFC 5737
  documentation ranges.
- **Physics:**
  - Daily demand has morning and evening peaks in Australia/Adelaide time, with daylight saving handled.
  - Duty and standby pumps run on reservoir level with hysteresis, and the lead pump rotates daily.
  - Pressure follows pump state.
  - Chlorine residual tracks the dosing setpoint with a slow first-order lag and Gaussian noise. Sensor
    dropouts (`quality = bad`) occur about 0.15% of the time.
  - Tests hold every site inside its operating bands for 14 simulated days.
- **Determinism:** each simulated minute has its own generator, seeded by hash(seed, site, minute,
  purpose). Event IDs are hash-derived UUIDs. The same seed, site and time always give byte-identical
  files, however the minutes are chunked and even across Durable Object eviction (both are tested).
- **Baseline traffic:**
  - The HMI polls every controller every 2 seconds (aggregated per minute). It reports to SCADA, and the
    historian pulls from it.
  - A weekly vendor maintenance session runs on Wednesdays in business hours, with MFA (multi-factor
    authentication) passing.
  - Employees occasionally log in remotely.
  - Operators sometimes trim the chlorine setpoint within the normal band.
  - The sensor raises 2–5 low-severity noise alerts per site per day.
- **Backfill:** `npm run backfill -- --site PS03 --days 7 [--scenario rogue_setpoint@3]` generates history
  in Node at roughly 2,000 simulated minutes a second. `--all` covers every site and head office. Upload
  it with `npm run backfill -- --upload` (8 PUTs in parallel; safe to re-run).

## Incident scenarios

Trigger a scenario on demand with `POST /scenarios/{name}?site=PS03` (see [below](#triggering-a-scenario)).
Scenarios are also injected at random, at `RANDOM_SCENARIOS_PER_SITE_DAY` (default 0.05, about one per
site every 20 days). Only one runs per site at a time.

| Scenario | Default start | What happens |
| --- | --- | --- |
| `rogue_setpoint` | next 02:00 local (`start=now` to override) | 3 MFA push denials from an unusual country, then an approval → out-of-hours vendor RDP session to the engineering workstation → Modbus write of the chlorine setpoint to 3.8 mg/L → residual rises above 1.5 mg/L within about 15 minutes and keeps climbing for 40+ → the sensor raises only a **medium** alert → the operator restores the setpoint at +90 minutes |
| `rogue_device` | now | An unknown-vendor device appears → scans ports 502, 20000 and 4840 across 50 addresses in 3 minutes → sends read-only Modbus requests to every PLC → removed after 3 hours |
| `unauthorised_logic_change` | now (moved after the window if it is open) | The **HMI** downloads a program to the pump PLC outside the change window; firmware is unchanged but the logic checksum changes; the sensor raises only a low alert; the lead pump short-cycles until the original program is restored in the next change window |

The ground truth is written **only** to `landing/_ground_truth/scenario_log/`. The API response does not
include the scenario ID, and no public feed contains it (tested). In the lakehouse, only
`gold_detection_scorecard` reads `silver_scenario_log`, and a test fails if detection code references it.
To lock it down, revoke `SELECT` on `bronze_scenario_log`, `silver_scenario_log` and
`gold_detection_scorecard` from analysts.

## Detections

Rule IDs, severities and techniques live in `contracts/reference/ot_reference.yaml`. The logic is in
`lakehouse/src/quandong/detections.py`.

| Rule | Logic | Severity | MITRE ATT&CK for ICS |
| --- | --- | --- | --- |
| QD-001 | Vendor session started outside business hours (weekdays 07:00–19:00 local) | high | T0822 External Remote Services |
| QD-002 | ≥ 3 MFA denials, then an approval for the same user within 15 minutes | high | T0859 Valid Accounts (Enterprise T1621) |
| QD-003 | Setpoint write outside the safe band | critical | T0836 Modify Parameter |
| QD-004 | Measured process value outside its band for more than 10 minutes | high | T0831 Manipulation of Control |
| QD-005 | Asset first seen more than 24 hours after the site's first data | medium (high if the vendor is not approved) | T0864 Transient Cyber Asset |
| QD-006 | One source to ≥ 10 distinct address/port pairs within 5 minutes | high | T0846 Remote System Discovery |
| QD-007 | Program download or firmware update outside the change window (Tuesday 10:00–14:00) or from a non-engineering host | critical | T0843 Program Download |

Every finding has a severity, a technique, its evidence event IDs and a `correlation_id`. Findings at the
same site that start within 2 hours of the previous one's end share an incident
(`INC-{site}-{yyyyMMdd-HHmm}`).

- `gold_incidents` gives each incident a plain-English summary, including what the OT sensor itself rated it.
- `gold_detection_scorecard` reports, for each scenario, whether it was detected, the rule detection rate
  and the time to detect (measured in event time).

The end-to-end test (`lakehouse/tests/test_end_to_end.py`) generates 3 days for five sites: one clean, three
with planted scenarios, plus head office. It confirms that every scenario is detected with all its expected
rules as a single incident, and that the clean site produces **no** findings.

## Setting up Databricks Free Edition

Deploy the bundle first, so the volume exists before the generator starts writing.

1. **Sign up** at <https://www.databricks.com/learn/free-edition>. Your workspace URL looks like
   `https://dbc-xxxxxxxx-xxxx.cloud.databricks.com`. The catalog `workspace` and the SQL warehouse
   **Serverless Starter Warehouse** already exist.
2. **Install the Databricks command-line interface (CLI), version 0.283.0 or later** (needed for the dashboard's
   `dataset_catalog` and `dataset_schema`). Use Homebrew (`brew tap databricks/tap && brew install databricks`)
   or the script at <https://github.com/databricks/setup-cli>.
3. **Log in:**
   ```bash
   databricks auth login --host https://dbc-xxxxxxxx-xxxx.cloud.databricks.com
   ```
4. **Validate and deploy** the bundle. This creates the schema `quandong_twin`, the managed volume `landing`,
   the pipeline, the paused job and the dashboard:
   ```bash
   cd quandong-twin/lakehouse
   ```
   ```bash
   databricks bundle validate
   ```
   ```bash
   databricks bundle deploy
   ```
   If you don't use the bundle, create the volume by hand in a SQL editor:
   `CREATE SCHEMA IF NOT EXISTS workspace.quandong_twin; CREATE VOLUME IF NOT EXISTS workspace.quandong_twin.landing;`
5. **Create a personal access token (PAT)** for the generator: profile menu → **Settings** → **Developer** →
   **Access tokens** → **Manage** → **Generate new token**. Give it a comment such as "quandong generator" and
   a lifetime such as 90 days, then copy the `dapi…` value. It acts as you, so it already has write access to
   the volume you own. Rotate it before it expires (see Troubleshooting).
6. **Run the pipeline** once data is landing (after the Cloudflare setup below):
   ```bash
   databricks bundle run quandong_twin
   ```
   Then **unpause the refresh job** (`quandong-twin-refresh`) in **Jobs & Pipelines**, or set `pause_status: UNPAUSED`
   in `resources/job.yml` and redeploy. Open the dashboard **Quandong OT — Murray Flats Water**.

The bundle uses no development mode, because that would prefix the schema and volume names (`dev_<user>_…`)
while the generator writes to a fixed path. If you change `schema` or `volume`, change `DATABRICKS_SCHEMA`
and `DATABRICKS_VOLUME` in `generator/wrangler.jsonc` to match.

## Setting up Cloudflare

1. Create a free Cloudflare account and log Wrangler in:
   ```bash
   cd quandong-twin && npx wrangler login
   ```
2. Set the three secrets. Wrangler prompts for each value; never commit them.
   ```bash
   npx wrangler secret put DATABRICKS_HOST --config generator/wrangler.jsonc      # https://dbc-….cloud.databricks.com
   ```
   ```bash
   npx wrangler secret put DATABRICKS_TOKEN --config generator/wrangler.jsonc     # the dapi… token
   ```
   ```bash
   npx wrangler secret put SCENARIO_API_KEY --config generator/wrangler.jsonc     # 16+ random characters
   ```
   A good key: `openssl rand -hex 24`.
3. Optional: backfill history so the dashboards have something to show from the start. Do this before step 4,
   so backfilled and live windows don't overlap.
   ```bash
   npm run backfill -- --all --days 7 --scenario rogue_device@4
   ```
   ```bash
   DATABRICKS_HOST=https://dbc-….cloud.databricks.com DATABRICKS_TOKEN=dapi… npm run backfill -- --upload
   ```
4. Deploy:
   ```bash
   npm run deploy
   ```
   Within 5 minutes the cron trigger starts every site. Check with
   `curl -H "X-Scenario-Key: $KEY" https://quandong-twin-generator.<your-subdomain>.workers.dev/status`
   and watch files appear under **Catalog → workspace → quandong_twin → landing**.
   `npx wrangler tail --config generator/wrangler.jsonc` shows the flush log.

## Triggering a scenario

```bash
curl -X POST -H "X-Scenario-Key: $SCENARIO_API_KEY" "https://quandong-twin-generator.<your-subdomain>.workers.dev/scenarios/rogue_setpoint?site=PS03"
```

The call returns `202` with `starts_at`. `rogue_setpoint` waits for 02:00 local; add `&start=now` to run it
immediately (QD-001 then fires only if "now" is outside business hours). Scenario names are `rogue_setpoint`,
`rogue_device` and `unauthorised_logic_change`. A `409` means a scenario is already scheduled or running at
that site. Detections appear after the next pipeline refresh.

## Cost and quota arithmetic

Everything runs on free tiers. Limits were checked against the Cloudflare and Databricks docs in November 2026.

### Cloudflare Workers Free (defaults: 5 pump stations + head office, `TICK_MINUTES=1`)

| Meter (Free limit) | Arithmetic | Per day | Share |
| --- | --- | --- | --- |
| Worker requests (100,000/day) | 288 cron runs (every 5 min) + a few API calls | ~300 | 0.3% |
| Durable Object requests (100,000/day; alarms and RPC count) | alarms 5 × 1,440 + HO 24 = 7,224; flush RPCs 6 × 288 = 1,728 | ~8,950 | 9% |
| DO SQLite rows written (100,000/day; **setAlarm and deletes count**) | per site: 1,440 outbox inserts + 1,440 setAlarm + 1,440 deletes + 288 checkpoints = 4,608 → × 5 = 23,040; HO ≈ 890 | ~23,900 | 24% |
| DO rows read (5,000,000/day) | a few rows per flush | < 10,000 | < 1% |
| DO duration (13,000 GB-s/day) | 128 MB × (alarm ≈ 10 ms × 7,224 + flush ≈ 1.5 s × 1,440) | ~280 GB-s | 2% |
| CPU per invocation (10 ms) | one simulated minute ≈ 0.15 ms; catch-up capped at 30 minutes per alarm | < 5 ms | |
| Subrequests per invocation (50) | each object PUTs ≤ 8 files per window; budget capped at 40 including retries | ≤ 40 | |
| Cron triggers (5 per account) | 1 | | |
| DO storage (5 GB) | the outbox is drained every 5 minutes | < 10 MB | |

Idle time between alarms is **not** billed for duration: an object with nothing in flight qualifies for
hibernation. The outbox stores one row per alarm, each holding pre-serialised NDJSON for every feed, never
one row per event. A row per event (about 21 per site-minute) would cost about 150,000 rows written per day
for 5 sites, over the limit.

**Scaling to 40 sites** is a configuration change. Set `SITE_COUNT=40` and `TICK_MINUTES=5`, so each alarm
simulates 5 minutes and events stay at one-minute resolution. Per site: 288 × (insert + setAlarm + delete +
checkpoint) = 1,152 rows, so 40 sites ≈ 46,000 rows written (46%). DO requests come to 40 × 288 alarms +
41 × 288 RPCs ≈ 23,300 (23%). `TICK_MINUTES=1` works up to about 15 sites (15 × 4,608 ≈ 69,000 rows).
`TICK_MINUTES` must divide `FLUSH_WINDOW_MINUTES`.

### Databricks Free Edition

| Item | Default | Notes |
| --- | --- | --- |
| Data landed | ~121,000 events, **~53 MB**, ~4,350 files per day (5 sites) | ~1.6 GB a month. Set `FLUSH_WINDOW_MINUTES=15` to cut files to ~1,450 a day |
| Pipelines | 1 (triggered, serverless) | Free Edition allows one active pipeline per type |
| Job | 1 task, every 30 minutes, **paused** | ≤ 5 concurrent tasks allowed |
| SQL warehouse | the existing 2X-Small starter warehouse | used only by the dashboard |
| Outbound internet | none needed | Cloudflare pushes in |

Free Edition has a daily fair-usage compute quota. If you exceed it, compute is shut down for the rest of
the day. A refresh every 30 minutes means 48 serverless pipeline updates a day. If you hit the quota,
change `refresh_cron` to hourly (`0 0 * * * ?`) or every 2 hours.

## Configuration reference

Set these in `generator/wrangler.jsonc` under `vars`, or in `.dev.vars` locally:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SIM_SEED` | `quandong-mfw-1` | Seed for every random choice; changing it changes all data |
| `GENERATOR_RUN_ID` | `mfw-twin-{seed}` | Stamped on every event |
| `SITE_COUNT` | 5 | Pump stations (1–40) |
| `TICK_MINUTES` | 1 | Simulated minutes per alarm (head office always uses 60) |
| `FLUSH_WINDOW_MINUTES` | 5 | Width of each landed file's time window |
| `MAX_CATCHUP_MINUTES` | 360 | If a site falls further behind than this (for example after a pause), it skips ahead |
| `RANDOM_SCENARIOS_PER_SITE_DAY` | 0.05 | Random incident rate; 0 disables |
| `DATABRICKS_CATALOG` / `_SCHEMA` / `_VOLUME` | workspace / quandong_twin / landing | Must match the bundle variables |
| Secrets | | `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `SCENARIO_API_KEY` (`wrangler secret put`) |
| `LOCAL_MODE` | unset | `true` only in `.dev.vars`: enables `/debug/advance` |

The bundle variables are `catalog`, `schema`, `volume`, `warehouse_id` (looked up by name) and `refresh_cron`.

## Testing

| Command | What it covers |
| --- | --- |
| `npm run gen:check` | generated code matches the contracts; contracts are valid ODCS v3.2.0 and match the common envelope |
| `npm test` | Vitest: seeded RNG (pinned values), Adelaide time and daylight saving, physics within bands for 14 days, engine determinism (chunking, eviction), every event valid against its contract, baseline behaviour, outbox and at-least-once flush, each scenario's event sequence, ground-truth isolation, sink retry, backoff, Retry-After, budget and idempotency (including 25% injected faults) |
| `npm run test:do` | the Durable Object inside workerd: alarms, eviction, cron fan-out, scenario API, local mode |
| `npm run smoke` | 2 simulated hours with `rogue_setpoint` through the real sink and the fake Files API; checks the NDJSON sequence |
| `npm run bundle:check` | bundle YAML against the published bundle JSON Schema; referenced paths; dashboard tables exist |
| `npm run lint`, `npm run typecheck` | ESLint (typescript-eslint strict, type-checked), TypeScript strict |
| `npm run test:py` | pytest: each detection rule, correlation, site health, compliance, scorecard, pipeline wiring, ground-truth isolation, end to end on generator output, every dashboard query |

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `wrangler tail` shows `flush incomplete … status 401/403` | The token is wrong or expired, or its user cannot write the volume. Create a new PAT and run `wrangler secret put DATABRICKS_TOKEN`. The outbox keeps the data; it is sent on the next cron run. |
| `status 404` with `RESOURCE_DOES_NOT_EXIST` | The volume doesn't exist yet (deploy the bundle first), or catalog, schema or volume differ between `wrangler.jsonc` and the bundle variables. |
| `DATABRICKS_HOST must start with https://` | Set the full workspace URL, including `https://`. |
| `DATABRICKS_HOST and DATABRICKS_TOKEN must be set` | Secrets are missing on the deployed Worker (`npx wrangler secret list --config generator/wrangler.jsonc`). |
| Durable Object errors after a few hours: daily limit exceeded | Too many sites for `TICK_MINUTES=1` (see [quotas](#cost-and-quota-arithmetic)). Set `TICK_MINUTES=5`. The free limits reset at 00:00 UTC. |
| `/status` shows `skippedMinutes` growing | The site fell more than `MAX_CATCHUP_MINUTES` behind (paused account, quota hit) and skipped ahead. Site health shows the gap. |
| Files land but bronze is empty | `quandong.landing_root` in `resources/pipeline.yml` doesn't match the volume path. Run the pipeline update with **Full refresh** after fixing it. |
| Silver row counts lower than bronze | Expectations dropped structural failures. See the pipeline's **Data quality** tab or query the event log table `quandong_pipeline_event_log`. |
| Rows in `_rescued_data` | An event had a field the contract doesn't define: update the contract, run `npm run gen`, redeploy both halves. |
| Compute unavailable for the rest of the day | Free Edition fair-usage quota. Pause the job or make `refresh_cron` less frequent. |
| `bundle deploy` complains the dashboard was modified remotely | Run `databricks bundle generate dashboard --resource quandong_ot` to pull your UI edits, or deploy with `--force` to overwrite them. |
| A dashboard widget fails to render | The `.lvdash.json` was written by hand and its SQL tested in Spark, but not imported into a workspace. Fix the widget in the UI, then run `bundle generate dashboard`. |
| Names come out as `dev_<user>_quandong_twin` | You deployed with `mode: development`. Use the default `free` target. |
| Scenario API returns 401 | The `X-Scenario-Key` header is missing or wrong, or `SCENARIO_API_KEY` is shorter than 16 characters. |
| Backfilled data seems to replace live data | Their windows overlapped, and the second file with the same name was skipped (409). Backfill with `--end` set before the live start. |
| `npm run dev` lands nothing | Start `npm run local-files-api` first, and make sure `generator/.dev.vars` points `DATABRICKS_HOST` at `http://localhost:8788`. |
| `bundle destroy` removed my data | It deletes the schema and volume it created. Back up first, or remove `resources/storage.yml` and manage them by hand. |

## Known limitations

- **Nothing has been deployed** to Cloudflare or Databricks. `databricks bundle validate` hasn't been run
  either (it needs a workspace login). The bundle has been checked against the published JSON Schema, and
  the pipeline logic and every dashboard query run in local Spark. The real serverless runtime hasn't been
  exercised: Auto Loader options, `dropDuplicatesWithinWatermark` on serverless, the event log, and
  importing the dashboard JSON. Expect small fixes on first deploy.
- Gold tables are materialised views that recompute over all silver history. That is fine for weeks of
  demo data; for months, add retention or make the detections incremental.
- Time to detect is measured in **event time**. Pipeline latency (up to the refresh interval) comes on top.
- Correlation is a simple per-site time gap. Campaigns across sites are not linked.
- The asset baseline is "seen in the site's first 24 hours of data", so a rogue device planted in the first
  day is not flagged as new.
- Compliance degradation comes from scenario signals the generator raises, not from the lakehouse's own
  detections.
- The PAT acts as your user. A service principal with only `WRITE VOLUME` would be better if your
  workspace supports it.
- The scenario API has a shared-secret header but no rate limiting.
- The dashboard has no site filter; the chlorine and pressure charts show the last 3 days for all sites.
- ODCS has no include mechanism, so every contract repeats the envelope. A check enforces it matches
  `common.yaml`.

## Changes from the original brief

| Change | Reason |
| --- | --- |
| Flush runs **inside each Durable Object**, triggered by the cron Worker over RPC | Workers Free allows 50 external subrequests per invocation; one Worker PUTting 40 sites × 7 feeds would need 280 |
| One outbox row per alarm (pre-serialised NDJSON), plus `TICK_MINUTES` for scale | Free plan: 100,000 rows written per day, and every `setAlarm()` and delete counts |
| Files cover fixed 5-minute windows (`{site}_{window_start_ms}.jsonl`) | Content stays identical on retry, so `overwrite=false` gives idempotency |
| Backfill is a Node script (with parallel upload), not a Worker endpoint | No 10 ms CPU limit and no request budget; the same deterministic engine |
| Local mode uses a fake Files API that writes `./out/` | A Worker cannot write to the local disk; this way the real sink code runs offline |
| Head office is a 6th Durable Object producing `compliance_evidence` | Gives one control per day for the customer, with scenario-driven status changes |
| `remote_access` has one row per state change (`rejected` / `started` / `ended`) | MFA fatigue needs the denied attempts; a real gateway reports a session's end only when it ends |
| Routine polls aggregated per minute with `command_count` | One row per poll would be ~100,000 rows per site per day |
| Added fields: `logic_checksum`, `mac_address`, `change_type`, `connection_state`, `transport`, `initiator_ip`, `command_count`, `result`, `logic_checksum_before/after`, `rule_name`, `src_ip`, `maturity_level`, `assessment_date`, `notes`, `session_state`, `mfa_method`, `protocol`, `asset_id` on telemetry | Needed by the scenarios and detections |
| `user` renamed to `username` | Spark SQL resolves a bare `user` as the current-user function |
| ODCS **v3.2.0** | The latest published schema version |
| `from pyspark import pipelines as dp` | The current API; the docs say the `dlt` module "has been replaced" (it still works) |
| "Declarative Automation Bundles" | Databricks renamed Databricks Asset Bundles in March 2026; `databricks.yml` is unchanged |
| MFA fatigue uses T0859 (ICS), plus Enterprise T1621 | The ICS matrix has no MFA-fatigue technique |
| `rogue_setpoint` defaults to the next 02:00 local (`start=now` to override) | The story needs an out-of-hours start |
| Site health uses Adelaide clock hours | The +9:30 / +10:30 offset would split every UTC hour bucket |
| The twin lives in `quandong-twin/` | This repository already holds an unrelated website; the subfolder keeps the two apart |
