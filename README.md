# SIRENE GeoData Observatory — French Business Intelligence Platform

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![DuckDB](https://img.shields.io/badge/Engine-DuckDB-FFF000.svg)](https://duckdb.org/)
[![Flask](https://img.shields.io/badge/API-Flask-000000.svg)](https://flask.palletsprojects.com/)
[![Leaflet](https://img.shields.io/badge/Maps-Leaflet-199900.svg)](https://leafletjs.com/)
[![Google Maps](https://img.shields.io/badge/Basemap-Google%20Roadmap%20%26%20Satellite-4285F4.svg)](https://maps.google.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An analytical geospatial platform and interactive observatory for the **INSEE SIRENE** French National Enterprise Registry, combining high-speed streaming data processing with an enterprise GIS dashboard featuring live business mapping, calibrated density heatmaps, traffic overlays, and parking intelligence.

Covers **Mainland France** across **96 departments**, **35,000+ communes**, **15.96M+ active establishments**, with **84.52% precise WGS84 GPS geocoding** and all **738 official NAF 2008 Rev 2 economic activity sectors**.

---

## Key Highlights & Capabilities

### Core Analytics Engine
- **DuckDB Out-of-Core Processing:** Sub-second streaming SQL analytics over 35+ million raw records without memory bottlenecks or database overhead.
- **14M+ Geocoded Establishments:** Real-time bounding-box queries against the full parquet dataset in ~0.04s via DuckDB.

### Interactive GIS Dashboard
- **Retina @2x Basemaps:** Crystal-clear 512×512px tiles across three modes:
  - **Google Maps Roadmap** — street names, shops, and places in French
  - **Google Satellite** — hybrid imagery with labels
  - **Esri Dark Gray** — clean dark analytics canvas (no watermarks)
- **Live Business Map Pins:** At zoom ≥ 14, real establishments appear as interactive markers with exact INSEE geocoded coordinates. Each pin shows:
  - Business name, SIRET code, NAF activity sector
  - Official verification link to [data.gouv.fr](https://annuaire-entreprises.data.gouv.fr)
  - One-click Google Maps navigation
- **Calibrated Density Heatmap:** Continuous thermal gradient (cyan → green → yellow → orange → red) built from authentic business density:
  - National view: 769 calibrated clusters (≥2,800 establishments per 10km cell)
  - Zoom-adaptive: switches to high-resolution 100m grid at zoom ≥ 10
  - Log-normalized with `max: 2.4` so only Paris core reaches crimson red
- **Live Traffic Layer:** Google Maps real-time traffic conditions overlay.
- **Parking Radar:** Nearby parking facilities within configurable radius (150m / 300m / 500m) around any selected business.
- **Regional Choropleth:** Department-level density visualization with zoom-adaptive opacity.
- **Fullscreen Mode:** Immersive edge-to-edge map view.

### 3-Pillar Analytics Sidebar
- **Departments Tab:** Full list of 96 departments ranked by business volume, density choropleth, and geocoding percentage.
- **Communes (Cities) Tab:** Top French cities (Paris, Lyon, Marseille, Toulouse, Nice, Bordeaux, etc.) with company counts, centroid coordinates, and instant fly-to navigation.
- **Industries (NAF) Tab:** Complete hierarchy of 738 official French economic sectors (e.g., Tech, Hospitality, Real Estate, Consulting, Healthcare, Retail).

### Deep Business Explorer
- Search businesses by name, commercial trade sign (*enseigne*), or 14-digit **SIRET**.
- Filter simultaneously by **Department**, **Commune (City)**, and **Niche (NAF)**.
- Direct links to **Official French Legal Verification** (`annuaire-entreprises.data.gouv.fr/etablissement/<siret>`).
- One-click **Pin on Map** with exact GPS coordinates from the registry.
- Infinite scroll and batch pagination (+50 establishments per fetch).
- One-click **CSV Export** of filtered business cohorts.

### Collapsible Map Legend
- Unified legend panel with toggle controls for each layer (Regions, Heatmap, Traffic, Parking).
- Real-time ON/OFF state indicators.
- Heatmap radius selector (Tight / Balanced / Broad).

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
                               │  - Left join establishments on siret         │
                               └──────────────────────┬───────────────────────┘
                                                      │
                                                      ▼
                               ┌──────────────────────────────────────────────┐
                               │  Clean Geospatial Parquet (Processed Layer)  │
                               │   data/processed/active_establishments_geo   │
                               │   14,023,282 geocoded establishments         │
                               └──────────────────────┬───────────────────────┘
                                                      │
                          ┌───────────────────────────┴───────────────────────────┐
                          ▼                                                       ▼
           ┌───────────────────────────────┐                       ┌───────────────────────────────┐
           │      DuckDB Analytics CLI     │                       │     Flask REST API Server     │
           │  - NAF x Dept matrix reports  │                       │  - Business map endpoint      │
           │  - Top industries ranking     │                       │  - Crowd heatmap engine       │
           │  - CSV / JSON summaries       │                       │  - Parking proximity search   │
           └───────────────────────────────┘                       │  - GeoJSON boundary feeds     │
                                                                   └──────────────┬────────────────┘
                                                                                  │ (REST JSON)
                                                                                  ▼
                                                                   ┌───────────────────────────────┐
                                                                   │     SIRENE Web Observatory    │
                                                                   │  - Retina @2x basemaps        │
                                                                   │  - Live business pins         │
                                                                   │  - Calibrated density heatmap │
                                                                   │  - Traffic & parking layers   │
                                                                   │  - Dept/City/Industry sidebar │
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

### 2. Launch the Dashboard

If processed data is already generated or cached:

```bash
python run.py serve
```

*Or double click `start_dashboard.bat` on Windows.*

Open your browser at:
👉 **`http://localhost:8000`**

---

## Data Pipeline CLI (`run.py`)

The pipeline CLI automates the entire lifecycle from API discovery to interactive exploration:

| Command | Description |
| :--- | :--- |
| `python run.py discover` | Queries `data.gouv.fr` API for the latest monthly INSEE Parquet publications. |
| `python run.py sample --limit 25000` | Rapid end-to-end dry run on remote Parquet files without downloading 3 GB. |
| `python run.py download` | Resumable chunked download of full raw datasets with SHA1 checksum validation. |
| `python run.py process` | Runs DuckDB streaming ETL: filters active entities, transforms CRS coordinates to WGS84, and joins geolocation data. |
| `python run.py analyze` | Generates analytical summaries (NAF distribution per department, top industries). |
| `python run.py analyze --naf "56.10A,62.01Z"` | Generates departmental distribution report for specific NAF activity codes. |
| `python run.py serve --port 8000` | Starts the high-performance Flask API and web observatory. |
| `python run.py all` | Runs complete pipeline sequentially: discover -> download -> process -> analyze -> serve. |

---

## REST API Reference

The backend provides low-latency REST endpoints querying the processed dataset:

### `GET /api/stats`
Returns high-level national totals:
```json
{
  "total_establishments": 15965766,
  "geocoded_establishments": 13494701,
  "geocoded_pct": 84.52,
  "total_departments": 96,
  "total_naf_industries": 735
}
```

### `GET /api/departments`
Returns aggregated statistics for all 96 mainland departments:
```json
[
  {
    "dept": "75",
    "name": "Paris",
    "total": 1337535,
    "geocoded": 1058204,
    "geocoded_pct": 79.12,
    "density_rank": 1
  }
]
```

### `GET /api/communes`
Returns top 300+ French cities sorted by active business density with geographic center coordinates:
```json
[
  {
    "code_commune": "75056",
    "name": "PARIS",
    "dept": "75",
    "count": 1322294,
    "lat": 48.8588,
    "lon": 2.3470
  }
]
```

### `GET /api/businesses/map`
Returns geocoded establishments for map rendering within a bounding box or city.

**Query Parameters:**
- `min_lat`, `max_lat`, `min_lng`, `max_lng` *(float)*: Viewport bounding box coordinates.
- `city` *(string, optional)*: City name (e.g. `PARIS`).
- `dept` *(string, optional)*: Department code (e.g. `75`).
- `limit` *(int, default 60)*: Number of records to return.

**Response:**
```json
{
  "count": 5,
  "items": [
    {
      "siret": "10877145200019",
      "name": "BALAE",
      "naf_code": "96.04Z",
      "naf_label": "Physical Wellbeing & Spa Services",
      "city": "PARIS",
      "lat": 48.863,
      "lng": 2.348,
      "gov_verify_url": "https://annuaire-entreprises.data.gouv.fr/etablissement/10877145200019",
      "google_maps_url": "https://www.google.com/maps/search/?api=1&query=48.863,2.348"
    }
  ]
}
```

### `GET /api/crowd/heatmap`
Returns calibrated density heatmap coordinates `[[lat, lon, weight], ...]`.

**Query Parameters (optional):**
- `min_lat`, `max_lat`, `min_lon`, `max_lon` *(float)*: Viewport bounding box for high-resolution local query.
- Without parameters: returns 769 pre-computed national density clusters.

### `GET /api/parking/nearby`
Returns parking facilities near a given location.

**Query Parameters:**
- `lat`, `lon` *(float)*: Center coordinates.
- `radius` *(int, default 300)*: Search radius in meters.

### `GET /api/businesses`
Searches and returns individual establishments with full details.

**Query Parameters:**
- `dept` *(string)*: Department code (e.g. `69` or `75`).
- `commune` *(string, optional)*: City name or commune code (e.g. `LYON`).
- `naf` *(string, optional)*: Specific NAF code (e.g. `56.10A`, `62.01Z`).
- `q` *(string, optional)*: Search query matching company name, trade sign, or SIRET.
- `limit` *(int, default 50)*: Number of records to return.
- `offset` *(int, default 0)*: Pagination offset.

### `GET /api/naf`
Returns the complete INSEE NAF 2008 Rev 2 taxonomy with official English and French legal designations.

### `GET /api/geojson`
Returns GeoJSON boundary multipolygons for French departments for interactive map rendering.

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
│   ├── server.py             # Flask REST API with DuckDB-backed endpoints
│   ├── crowd_data.py         # Heatmap engine: national clusters & viewport aggregation
│   ├── naf_data.py           # Dual INSEE NAF 2008 / 2025 taxonomy loader
│   ├── naf_complete.json     # Complete 738 NAF 2008 codes metadata (EN + FR)
│   ├── naf_2025_complete.json# Complete 747 NAF 2025 codes metadata (EN + FR)
│   ├── top_communes.json     # Precomputed French cities index with GPS centroids
│   ├── crowd_heatmap_points.json # Pre-cached national density clusters
│   └── static/
│       ├── index.html        # HTML5 observatory layout (Material 3 tokens & Inter)
│       ├── style.css         # Material 3 Canonical Theme (Dynamic Light / Dark)
│       ├── app.js            # Leaflet GIS engine: SireneLogger, basemaps, pins, modal
│       └── vendor/           # Leaflet.js, leaflet-heat.js (vendored offline)
├── data/
│   ├── france_departements.geojson # National departmental boundaries
│   ├── naf/                  # Official INSEE Excel taxonomy structures
│   ├── raw/                  # Downloaded INSEE parquet files
│   └── processed/            # active_establishments_geo.parquet (13.5M+ geocoded)
├── logs/                     # Rotating system log directory (sirene.log)
├── requirements.txt          # Production dependencies
├── run.py                    # Unified CLI management entrypoint
├── start_dashboard.sh        # macOS / Linux one-click launcher
├── start_dashboard.bat       # Windows one-click launcher
└── README.md                 # Project documentation
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Data Engine | **DuckDB** | Out-of-core SQL over 14M+ row Parquet files |
| Backend | **Flask** | REST API serving business, heatmap, parking, and GeoJSON data |
| Frontend | **Leaflet.js** | Interactive map with layers, markers, popups |
| Heatmap | **leaflet-heat** | Canvas-based thermal density visualization |
| Basemaps | **Google Maps @2x** / **Esri Dark** | Retina-quality tile layers |
| Data Source | **INSEE SIRENE** | Official French enterprise registry (15.96M establishments) |
| Geocoding | **INSEE Geolocation** | WGS84 coordinates for 84.52% of establishments |

---

## Data Sources & Legal Compliance

- **Establishment Register:** INSEE SIRENE `StockEtablissement` via [data.gouv.fr](https://www.data.gouv.fr/fr/datasets/base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret/).
- **Geographic Coordinates:** INSEE Geolocation Layer via [data.gouv.fr](https://www.data.gouv.fr/fr/datasets/geolocalisation-des-etablissements-du-repertoire-sirene/).
- **Nomenclature of Activities:** INSEE NAF 2008 Rev 2 (`naf2008_liste_n5.xls`).
- **Official Enterprise Verification:** [Annuaire des Entreprises](https://annuaire-entreprises.data.gouv.fr/) (Direction interministérielle du numérique / DINUM).

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
Open data used under the [Licence Ouverte / Open Licence 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) (Etalab).
