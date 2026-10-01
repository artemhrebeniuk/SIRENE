# SIRENE GeoData Observatory — French Business Intelligence Platform

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![DuckDB](https://img.shields.io/badge/Engine-DuckDB-FFF000.svg)](https://duckdb.org/)
[![Flask](https://img.shields.io/badge/API-Flask-000000.svg)](https://flask.palletsprojects.com/)
[![Design](https://img.shields.io/badge/Design-Google%20Material%203-6750A4.svg)](material-design-design.md)
[![Maps](https://img.shields.io/badge/Maps-Leaflet%20%26%20Google%20Retina%20%402x-4285F4.svg)](https://maps.google.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An enterprise-grade analytical geospatial platform and interactive B2B intelligence observatory for the **INSEE SIRENE** French National Enterprise Registry. Combines high-speed out-of-core data processing powered by **DuckDB** with a modern **Google Material 3 (Material You)** interface, real-time spatial mapping, live official financial and executive governance intelligence, multi-establishment branch resolution, workforce size segmentation, calibrated footfall heatmaps, traffic overlays, logistics radar, and direct **Official French Government Registry Verification (data.gouv.fr)**.

Covers **Mainland France** across **96 departments**, **35,000+ communes**, **15.96M+ active establishments**, with **84.52% precise WGS84 GPS geocoding** (BAN parcel accuracy) and dual-classification support for **NAF 2008 Rev 2** (738 sectors) and upcoming **NAF 2025 Rev 2.1** (747 sectors).

---

## Key Highlights & Capabilities

### 1. Real-Time Financial & Executive Governance Intelligence (DGFiP / INPI)

- **Live Official State Integration:** Direct low-latency bridge to `recherche-entreprises.api.gouv.fr` (DINUM / DGFiP / INPI) with in-memory caching (< 190ms response).
- **Verified Financial Disclosures:** Displays genuine filed annual turnover (_Chiffre d'Affaires_ / CA), net profit or loss (_Résultat Net_), and the exact fiscal year filed.
- **Truth in Data:** Explicitly distinguishes verified government balance sheet figures from modeled statistical revenue brackets.
- **Board & Executive Officers:** Lists company CEOs, managing directors (_Dirigeants_, _Président_, _Gérant_), and their legal roles directly in the inspector drawer.

### 2. Workforce Intelligence & URSSAF Declaration Filtering

- **True Workforce Resolution:** Decodes official INSEE workforce tranches (`00`, `01`, `02`, `11`, `12`, `21`, `22`, `31` to `53`) alongside declared employer status (`caractereEmployeurEtablissement = 'O'`).
- **Eliminated False Zero-Staff Labels:** Solves the common registry pitfall where unfiled or newly registered entities (`NN`) were mistakenly labeled as "0 employees". Distinguishes true solo operators from pending URSSAF declarations.
- **Live SQL Segmentation:** On-the-fly DuckDB joins over 41.7M records enable instant filtering by team size:
  - **All Staff Sizes**
  - **With Staff (1+ Employees):** Filter for operational employers.
  - **10+ Employees (SMB / PME):** Qualified commercial targets.
  - **50+ Employees (Large Target):** Mid-market and enterprise entities.
  - **Solo / Micro:** Independent professionals and self-employed.

### 3. Physical Storefront vs Headquarters Resolution

- **Signboard & Facade Verification:** Accurately identifies commercial trade signs (_enseigne_) and customer-facing storefronts vs legal administrative seats (_siège social_ / domiciliation centers).
- **Multi-Branch Network Discovery:** When inspecting a legal registration address or corporate seat, one-click branch resolution (`/api/business/<siret>/locations`) identifies all physical operating outlets and retail shops of the same enterprise (SIREN) nationwide.
- **Instant Map Jump:** Allows users to immediately fly the map to the real, customer-facing shop front rather than an administrative mailbox.
- **Google Street View 360° Integration:** Direct links from table rows, map popups, and the inspector drawer to visually inspect building facades, window displays, and pedestrian access.

### 4. Interactive B2B Lead Scoring & Advertising Presets

- **Curated Advertising Niche Presets:** One-click filtering for high-demand B2B commercial categories:
  - 🍽️ **HoReCa:** Restaurants, Bistros, Bars, Boutique Hotels
  - 🚗 **Automotive:** Garages, Detailing, Bodywork, Dealerships
  - ⚕️ **Health & Wellness:** Dental Clinics, Medical Centers, Optical, Spas
  - 🏢 **Real Estate & Renovation:** Agencies, Interior Designers, General Contractors
  - 🛍️ **Retail & Boutiques:** Fashion, Luxury, Artisan Bakeries
- **Dynamic Lead Qualification Score (0–100):** Evaluates commercial presence, workforce size, multi-branch network, and operational vitality. Automatically flags permanently closed (_fermé_) businesses to prevent wasted ad spend.

### 5. Google Material 3 Design System (Material You)

Built strictly following the canonical [Material 3 Design Specification](material-design-design.md):

- **Tonal Color Architecture:** Built on official M3 baseline palettes (`#6750A4` Primary, `#625B71` Secondary, `#7D5260` Tertiary, `#B3261E` Error, `#141218`/`#FEF7FF` Surfaces).
- **Dynamic Light & Dark Themes:** Automatic detection and manual toggle with synchronized token switching and contrast compliance.
- **Official Typography:** Clean typography strictly leveraging Google Fonts **Roboto** (`display`, `headline`, `title`, `body`) and **Roboto Mono** for numeric metrics, SIRET identifiers, and technical coordinates.
- **De-Noised Directory Table:** Clean monospace click-to-copy SIRET chips, concise presence indicators, and streamlined action buttons.

### 6. Official French Registry Verification (Annuaire des Entreprises)

Verify any French establishment directly against the official French public service directory:

- **One-Click Official Verification:** Dedicated **Verify** button across business popups, inspector drawer, and modal table linking directly to `https://annuaire-entreprises.data.gouv.fr/etablissement/<siret>`.
- **Authoritative Data Source:** Instantly cross-reference INSEE SIRENE records, INPI National Register of Enterprises (RNE), URSSAF declarations, and official Bodacc filings.
- **Live Local Competitor Radar:** Dynamic DuckDB spatial query extracting the top nearest direct competitors within the same NAF sector, complete with Euclidean distance in meters, SIRET, and address.
- **Logistics & Parking Proximity:** OpenStreetMap-powered radar scanning nearby heavy-duty truck parking and commercial garages.

### 7. Interactive GIS Web Observatory

- **Retina @2x Basemaps:** Ultra-crisp 512×512px tiles across three modes:
  - **Google Maps Roadmap:** Street names, POIs, and addresses in French.
  - **Google Satellite:** High-resolution hybrid aerial imagery with annotated labels.
  - **Esri Dark Gray:** Sleek dark analytics canvas for density analysis.
- **Live Establishment Markers:** At zoom ≥ 14, real registered establishments appear with interactive custom pins distinguishing storefronts, branches, and headquarters.
- **Multi-Scale Real-Coordinate Density Heatmap:** Continuous thermal spectrum from soft lavender baseline (`#6750A4`) through violet, warm amber, up to flame crimson (`#B3261E`) for peak commercial cores. Zero artificial circular blur or grid-snapping distortion.
- **Real-Time Traffic Layer:** Live road traffic conditions overlay from Google Maps.
- **Freight & Logistics Radar:** Nearby truck and vehicle parking facilities within 150m, 300m, or 500m radius with clickable focus navigation.
- **Departmental Choropleth:** Regional density boundaries with zoom-adaptive stroke weight and hover inspection.

---

## System Architecture

```
                               ┌──────────────────────────────────────────────┐
                               │             INSEE SIRENE & GeoData           │
                               │  - StockEtablissement (data.gouv.fr)        │
                               │  - Geolocation Layer (data.gouv.fr)         │
                               └──────────────────────┬───────────────────────┘
                                                      │ (Parquet / ZSTD)
                                                      ▼
                               ┌──────────────────────────────────────────────┐
                               │           DuckDB Streaming ETL               │
                               │  - Filter active units (etat = 'A')          │
                               │  - Multi-CRS normalisation -> WGS84 (4326)   │
                               │  - Left join establishments on SIRET         │
                               └──────────────────────┬───────────────────────┘
                                                      │
                                                      ▼
                               ┌──────────────────────────────────────────────┐
                               │  Clean Geospatial Parquet (Processed Layer)  │
                               │   data/processed/active_establishments_geo   │
                               │   14,023,282 geocoded establishments         │
                               └──────────────────────┬───────────────────────┘
                                                      │
                           ┌──────────────────────────┴───────────────────────────┐
                           ▼                                                      ▼
            ┌───────────────────────────────┐                      ┌───────────────────────────────┐
            │      DuckDB Analytics CLI     │                      │     Flask REST API Server     │
            │  - NAF x Dept matrix reports  │                      │  - Spatial business queries   │
            │  - Top industries ranking     │                      │  - Density heatmap engine     │
            │  - CSV / JSON summaries       │                      │  - Live financial enrichment  │
            └───────────────────────────────┘                      │  - Official Gov Verification  │
                                                                   │  - Branch & store resolution  │
                                                                   │  - OSM Logistics & Parking    │
                                                                   └──────────────┬────────────────┘
                                                                                  │ (REST / JSON / GeoJSON)
                                                                                  ▼
                                                                   ┌───────────────────────────────┐
                                                                   │    SIRENE Web Observatory     │
                                                                   │  - Google Material 3 Design   │
                                                                   │  - Retina @2x map engine      │
                                                                   │  - Official data.gouv.fr link │
                                                                   │  - Lead scoring & presets     │
                                                                   │  - Dual NAF 2008 / 2025 Mode  │
                                                                   └───────────────────────────────┘
```

---

## Quickstart Guide

### 1. Prerequisites & Installation

Ensure **Python 3.10+** is installed on your system.

```bash
git clone https://github.com/artemhrebeniuk/SIRENE.git
cd SIRENE
python -m pip install -r requirements.txt
```

### 2. Launch the Platform

If processed data is already generated or cached:

```bash
python run.py serve --port 8000
```

_Or run `./start_dashboard.sh` on macOS/Linux, or `start_dashboard.bat` on Windows._

Open your browser at:
👉 **`http://localhost:8000`**

To verify an establishment directly against the official French registry:
👉 **`http://localhost:8000/dossier/42298822000030`** _(redirects to annuaire-entreprises.data.gouv.fr)_

---

## Data Pipeline CLI (`run.py`)

The pipeline CLI automates the entire lifecycle from API discovery to interactive exploration:

| Command                                       | Description                                                                                                          |
| :-------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| `python run.py discover`                      | Queries `data.gouv.fr` API for the latest monthly INSEE Parquet publications.                                        |
| `python run.py sample --limit 25000`          | Rapid end-to-end dry run on remote Parquet files without downloading 3 GB.                                           |
| `python run.py download`                      | Resumable chunked download of full raw datasets with SHA1 checksum validation.                                       |
| `python run.py process`                       | Runs DuckDB streaming ETL: filters active entities, transforms CRS coordinates to WGS84, and joins geolocation data. |
| `python run.py analyze`                       | Generates analytical summaries (NAF distribution per department, top industries).                                    |
| `python run.py analyze --naf "56.10A,62.01Z"` | Generates departmental distribution report for specific NAF activity codes.                                          |
| `python run.py serve --port 8000`             | Starts the high-performance Flask API and web observatory.                                                           |
| `python run.py all`                           | Runs complete pipeline sequentially: discover -> download -> process -> analyze -> serve.                            |

---

## REST API Reference

The backend provides low-latency REST endpoints querying the processed dataset and state registries:

### `GET /api/businesses`

Searches and returns establishments with full lead scoring, workforce classification, and physical location verification.

**Query Parameters:**

- `dept` _(string, optional)_: Department code (e.g. `75`).
- `city` _(string, optional)_: City name (e.g. `PARIS`).
- `naf` _(string, optional)_: Specific NAF code (e.g. `56.10A`).
- `preset` _(string, optional)_: Advertising niche preset (`horeca`, `auto`, `health`, `realestate`, `retail`).
- `has_enseigne` _(boolean, optional)_: Filter only establishments with a registered trade sign.
- `branch_type` _(string, optional)_: `all`, `secondary` (branches), or `siege` (headquarters).
- `workforce` _(string, optional)_: `all`, `with_staff` (1+ employees), `10_plus`, `50_plus`, `micro`.
- `q` _(string, optional)_: Full-text search on name, sign, or SIRET.
- `limit` _(int, default 50)_, `offset` _(int, default 0)_.

### `GET /api/business/<siret>/enrich`

Fetches verified live financial statements and executive governance from the French National Registry:

```json
{
  "siren": "422988220",
  "siret": "42298822000030",
  "enriched": true,
  "nom_complet": "COFFRA GROUP (SOFFAL-SOFRADEC)",
  "forme_juridique": "5710",
  "total_etablissements": 3,
  "latest_fiscal_year": "2024",
  "turnover": 25049654,
  "net_profit": 1157484,
  "dirigeants": [
    {
      "name": "DANIEL ALLIMANT",
      "role": "Membre du directoire",
      "birth_year": "1958"
    }
  ]
}
```

### `GET /api/business/<siret>/locations`

Discovers all operational storefronts and secondary branches of the parent enterprise (SIREN) nationwide, including signboards, postal codes, and GPS coordinates.

### `GET /api/businesses/map`

Returns geocoded establishments for map rendering within a viewport bounding box or city, enriched with storefront classification and 360° view links.

### `GET /api/dossier/<siret>`

Returns comprehensive intelligence data for an establishment:

- Enterprise profile (SIRET, name, NAF code, legal label, full street address).
- Verified annual turnover, net profit, and corporate officers.
- Nearest direct competitors in the same NAF activity with distance in meters.
- Departmental density rank and territorial concentration stats.
- Nearby infrastructure (rail stations, motorways, truck parking, general parking).

### `GET /dossier/<siret>`

Redirects (302) directly to the official French Government enterprise page on `https://annuaire-entreprises.data.gouv.fr/etablissement/<siret>`.

### `GET /api/crowd/heatmap`

Returns authentic continuous heatmap coordinates `[[lat, lon, weight], ...]`. Supports both full national overview and real-time viewport bounding box streaming at sub-second latency.

### `GET /api/parking/nearby`

Returns parking facilities near a given location. Supports radius of 150m, 300m, or 500m.

---

## Directory Structure

```
SIRENE/
├── src/
│   ├── __init__.py           # Package marker
│   ├── config.py             # Global configuration, CRS definitions, directory paths
│   ├── logger.py             # Centralized logging engine with rotation & metric tracking
│   ├── fetcher.py            # data.gouv.fr API discovery & streaming download with SHA1
│   ├── pipeline.py           # DuckDB ETL: filtering, CRS conversion, spatial join
│   └── analytics.py          # Summary generator (NAF x Department cross-tabulation)
├── web/
│   ├── __init__.py           # Package marker
│   ├── server.py             # Flask REST API with DuckDB-backed spatial & financial endpoints
│   ├── lead_scoring.py       # Workforce engine, turnover brackets, and B2B ad scoring
│   ├── crowd_data.py         # Heatmap engine: national clusters & viewport aggregation
│   ├── naf_data.py           # Dual INSEE NAF 2008 / 2025 taxonomy loader
│   ├── naf_complete.json     # Complete 738 NAF 2008 codes metadata (EN + FR)
│   ├── naf_2025_complete.json# Complete 747 NAF 2025 codes metadata (EN + FR)
│   ├── top_communes.json     # Precomputed French cities index with GPS centroids
│   ├── crowd_heatmap_points.json # Pre-cached national density clusters
│   └── static/
│       ├── index.html        # Main observatory UI (Material 3 tokens & Roboto)
│       ├── style.css         # Material 3 Canonical Theme (Dynamic Light / Dark)
│       ├── app.js            # GIS Engine: SireneLogger, basemaps, pins, verification
│       └── vendor/           # Leaflet.js, leaflet-heat.js (offline vendored)
├── data/
│   ├── france_departements.geojson # National departmental boundaries
│   ├── naf/                  # Official INSEE Excel taxonomy structures
│   ├── raw/                  # Downloaded INSEE parquet files
│   └── processed/            # active_establishments_geo.parquet (13.5M+ geocoded)
├── logs/                     # Rotating system log directory (sirene.log)
├── material-design-design.md # Official Material 3 Design Specification & Token Guide
├── requirements.txt          # Production dependencies
├── run.py                    # Unified CLI management entrypoint
├── start_dashboard.sh        # macOS / Linux one-click launcher
├── start_dashboard.bat       # Windows one-click launcher
└── README.md                 # Project documentation
```

---

## Technology Stack

| Layer                  | Technology                     | Purpose                                                                   |
| :--------------------- | :----------------------------- | :------------------------------------------------------------------------ |
| **Design System**      | **Google Material 3 (M3)**     | Canonical Material You color roles, typography, elevation & shape scale   |
| **Data Engine**        | **DuckDB**                     | Out-of-core SQL analytics over 14M+ row geocoded Parquet files            |
| **Backend**            | **Flask**                      | REST API serving spatial queries, dossiers, heatmaps, and logistics       |
| **State Registry API** | **DINUM / DGFiP / INPI**       | Live official balance sheet turnover, net profits, and executive officers |
| **Mapping Engine**     | **Leaflet.js**                 | Interactive map layers, custom markers, popups, and polygons              |
| **Heatmap Engine**     | **leaflet-heat**               | High-performance canvas thermal density visualization                     |
| **Basemaps**           | **Google Maps @2x** / **Esri** | Ultra-crisp Retina tile layers (Roadmap, Satellite, Dark Gray)            |
| **State Verification** | **Annuaire des Entreprises**  | Direct links to official French Republic public registry (data.gouv.fr)   |
| **Data Source**        | **INSEE SIRENE**               | Official French enterprise registry (15.96M establishments)               |
| **Geocoding**          | **INSEE Geolocation**          | WGS84 coordinates for 84.52% of establishments                            |

---

## Data Sources & Legal Compliance

- **Establishment Register:** INSEE SIRENE `StockEtablissement` via [data.gouv.fr](https://www.data.gouv.fr/fr/datasets/base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret/).
- **Geographic Coordinates:** INSEE Geolocation Layer via [data.gouv.fr](https://www.data.gouv.fr/fr/datasets/geolocalisation-des-etablissements-du-repertoire-sirene/).
- **State Financial & Corporate Records:** [Annuaire des Entreprises API](https://recherche-entreprises.api.gouv.fr/) (Direction interministérielle du numérique / DINUM).
- **Nomenclature of Activities:** INSEE NAF 2008 Rev 2 & NAF 2025 Rev 2.1 via [insee.fr](https://www.insee.fr).
- **Official Enterprise Verification:** [Annuaire des Entreprises](https://annuaire-entreprises.data.gouv.fr/) (DINUM).

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
Open data used under the [Licence Ouverte / Open Licence 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) (Etalab).
