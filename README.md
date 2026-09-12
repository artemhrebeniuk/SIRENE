# SIRENE GeoData Observatory — French Business Intelligence Platform

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![DuckDB](https://img.shields.io/badge/Engine-DuckDB-FFF000.svg)](https://duckdb.org/)
[![Flask](https://img.shields.io/badge/API-Flask-000000.svg)](https://flask.palletsprojects.com/)
[![Leaflet](https://img.shields.io/badge/Maps-Leaflet-199900.svg)](https://leafletjs.com/)
[![Google Maps](https://img.shields.io/badge/Basemap-Google%20Roadmap%20%26%20Satellite-4285F4.svg)](https://maps.google.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An analytical geospatial platform and interactive observatory for the **INSEE SIRENE** French National Enterprise Registry, combining high-speed streaming data processing with a clean enterprise GIS dashboard.

Covers **Mainland France** across **96 departments**, **35,000+ communes**, **15.96M+ active establishments**, with **84.52% precise WGS84 GPS geocoding** and all **738 official NAF 2008 Rev 2 economic activity sectors**.

---

## Key Highlights & Capabilities

- **DuckDB Out-of-Core Processing:** Sub-second streaming SQL analytics over 35+ million raw records without memory bottlenecks or database overhead.
- **Radical UI/UX Redesign:** Enterprise-grade flat interface (Linear/GitHub dark style). **100% solid flat surfaces, zero gradients**, crisp 1px borders, high-contrast badges, and accessible typography (Inter).
- **Google Maps & Satellite Integration:** Instant switching between **Google Maps Roadmap**, **Google Satellite**, and **CartoDB Dark Matter** basemaps.
- **3-Pillar Analytics Sidebar:**
  - **Departments Tab:** Full list of 96 departments ranked by business volume, density choropleth, and geocoding percentage.
  - **Communes (Cities) Tab:** Top French cities (Paris, Lyon, Marseille, Toulouse, Nice, Bordeaux, etc.) with company counts, centroid coordinates, and instant fly-to navigation.
  - **Industries (NAF) Tab:** Complete hierarchy of 738 official French economic sectors (e.g., Tech, Hospitality, Real Estate, Consulting, Healthcare, Retail).
- **Deep Business Explorer Modal:**
  - Search businesses by name, commercial trade sign (*enseigne*), or 14-digit **SIRET**.
  - Filter simultaneously by **Department**, **Commune (City)**, and **Niche (NAF)**.
  - Direct links to **Official French Legal Verification** (`annuaire-entreprises.data.gouv.fr/etablissement/<siret>`).
  - One-click **Pin on Map** with Google Maps street coordinates.
  - Infinite scroll and batch pagination (+50 establishments per fetch).
  - One-click **CSV Export** of filtered business cohorts.

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
                               └──────────────────────┬───────────────────────┘
                                                      │
                          ┌───────────────────────────┴───────────────────────────┐
                          ▼                                                       ▼
           ┌───────────────────────────────┐                       ┌───────────────────────────────┐
           │      DuckDB Analytics CLI     │                       │     Flask REST API Server     │
           │  - NAF x Dept matrix reports  │                       │  - Fast parquet SQL queries   │
           │  - Top industries ranking     │                       │  - GeoJSON boundary feeds     │
           │  - CSV / JSON summaries       │                       │  - Live business directory    │
           └───────────────────────────────┘                       └──────────────┬────────────────┘
                                                                                  │ (REST JSON)
                                                                                  ▼
                                                                   ┌───────────────────────────────┐
                                                                   │     SIRENE Web Observatory    │
                                                                   │  - Zero-gradient flat design  │
                                                                   │  - Google Maps & Satellite    │
                                                                   │  - Communes & Dept inspector  │
                                                                   │  - Official Legal Verify link │
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
| `python run.py analyze` | Generates Milestone 6 analytical summaries (NAF distribution per department, top industries). |
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
  },
  {
    "code_commune": "69123",
    "name": "LYON",
    "dept": "69",
    "count": 185266,
    "lat": 45.7640,
    "lon": 4.8357
  }
]
```

### `GET /api/businesses`
Searches and returns individual establishments.

**Query Parameters:**
- `dept` *(string)*: Department code (e.g. `69` or `75`).
- `commune` *(string, optional)*: City name or commune code (e.g. `LYON`).
- `naf` *(string, optional)*: Specific NAF code (e.g. `56.10A`, `62.01Z`).
- `q` *(string, optional)*: Search query matching company name, trade sign, or SIRET.
- `limit` *(int, default 50)*: Number of records to return.
- `offset` *(int, default 0)*: Pagination offset.

**Response Structure:**
```json
{
  "count": 50,
  "total_available": 185266,
  "offset": 0,
  "limit": 50,
  "businesses": [
    {
      "siret": "53965022600050",
      "name": "CLUB COIFFURE CONFLUENCE",
      "enseigne": null,
      "naf": "96.02A",
      "naf_label": "Coiffure",
      "commune": "LYON",
      "code_postal": "69002",
      "latitude": 45.74289,
      "longitude": 4.81912,
      "dept": "69",
      "verification_url": "https://annuaire-entreprises.data.gouv.fr/etablissement/53965022600050"
    }
  ]
}
```

### `GET /api/naf`
Returns the complete INSEE NAF 2008 Rev 2 taxonomy with official English and French legal designations.

### `GET /api/geojson`
Returns GeoJSON boundary multipolygons for French departments for interactive map rendering.

---

## Directory Structure

```
SIRENE/
├── src/
│   ├── config.py             # Global configuration, CRS definitions, directory paths
│   ├── fetcher.py            # data.gouv.fr API discovery & streaming download with SHA1
│   ├── pipeline.py           # DuckDB ETL: filtering, CRS conversion, spatial join
│   └── analytics.py          # Summary generator (NAF x Department cross-tabulation)
├── web/
│   ├── server.py             # High-performance Flask REST API
│   ├── naf_data.py           # Official INSEE NAF 2008 taxonomy loader
│   ├── naf_complete.json     # Complete 738 NAF codes metadata (EN + FR)
│   ├── top_communes.json     # Precomputed French cities index with GPS centroids
│   └── static/
│       ├── index.html        # Clean HTML5 observatory layout (Inter typography)
│       ├── style.css         # Radical flat dark UI (100% solid, zero gradients)
│       └── app.js            # Leaflet & Google Maps cartography, dynamic filters
├── requirements.txt          # Production dependencies
├── run.py                    # Unified CLI management entrypoint
├── start_dashboard.bat       # Windows one-click launcher
└── README.md                 # Project documentation
```

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
