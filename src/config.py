"""
Configuration module for SIRENE data processing pipeline.
"""
from pathlib import Path

# Project directories
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
OUTPUT_DIR = BASE_DIR / "output"

# Ensure runtime directories exist
for directory in [DATA_DIR, RAW_DATA_DIR, PROCESSED_DATA_DIR, OUTPUT_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

# data.gouv.fr API Configuration
DATA_GOUV_API_BASE = "https://www.data.gouv.fr/api/1"

# Dataset Slugs / IDs on data.gouv.fr
DATASET_STOCK = "base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret"
DATASET_GEOLOC = "geolocalisation-des-etablissements-du-repertoire-sirene-pour-les-etudes-statistiques"

# Target file paths
STOCK_PARQUET_PATH = RAW_DATA_DIR / "stock_etablissement.parquet"
GEOLOC_PARQUET_PATH = RAW_DATA_DIR / "geoloc_etablissement.parquet"
COMBINED_PARQUET_PATH = PROCESSED_DATA_DIR / "active_establishments_geo.parquet"

# Summary output paths
SUMMARY_NAF_DEPT_CSV = OUTPUT_DIR / "sirene_summary_naf_departement.csv"
SUMMARY_TOP_NAF_CSV = OUTPUT_DIR / "sirene_summary_top_naf.csv"
SUMMARY_DEPTS_CSV = OUTPUT_DIR / "sirene_summary_departements.csv"
SUMMARY_REPORT_JSON = OUTPUT_DIR / "sirene_milestone6_report.json"

# Projections (EPSG)
CRS_METROPOLE = 2154    # RGF93 Lambert 93
CRS_GUADELOUPE = 5490   # RGAF09 UTM 20N
CRS_MARTINIQUE = 5490   # RGAF09 UTM 20N
CRS_GUYANE = 2972       # RGFG95 UTM 22N
CRS_REUNION = 2975      # RGR92 UTM 40S
CRS_WGS84 = 4326        # GPS decimal degrees
