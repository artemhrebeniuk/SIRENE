"""
Official NAF (Nomenclature of French Activities) dictionary.
Supports:
  - INSEE Official NAF 2008 Revision 2 (738 codes)
  - INSEE Official NAF 2025 (747 codes, Decree 2025-736)
Provides 100% official legal French designations, English translations, and cross-mapping.
"""

import json
import os
from src.logger import get_logger

logger = get_logger("naf")

_DIR = os.path.dirname(__file__)
NAF_CATALOG_2008 = {}
NAF_CATALOG_2025 = {}

NAF_2008_PATH = os.path.join(_DIR, 'naf_complete.json')
NAF_2025_PATH = os.path.join(_DIR, 'naf_2025_complete.json')

if os.path.exists(NAF_2008_PATH):
    try:
        with open(NAF_2008_PATH, 'r', encoding='utf-8') as f:
            NAF_CATALOG_2008 = json.load(f)
            logger.info(f"Loaded NAF 2008 catalog: {len(NAF_CATALOG_2008)} entries from {NAF_2008_PATH}")
    except Exception as e:
        logger.error(f"Failed to load NAF 2008 catalog from {NAF_2008_PATH}: {e}", exc_info=True)
else:
    logger.warning(f"NAF 2008 catalog file missing at: {NAF_2008_PATH}")

if os.path.exists(NAF_2025_PATH):
    try:
        with open(NAF_2025_PATH, 'r', encoding='utf-8') as f:
            NAF_CATALOG_2025 = json.load(f)
            logger.info(f"Loaded NAF 2025 catalog: {len(NAF_CATALOG_2025)} entries from {NAF_2025_PATH}")
    except Exception as e:
        logger.error(f"Failed to load NAF 2025 catalog from {NAF_2025_PATH}: {e}", exc_info=True)
else:
    logger.warning(f"NAF 2025 catalog file missing at: {NAF_2025_PATH}")

# Default alias for backwards compatibility
NAF_CATALOG = NAF_CATALOG_2008


def get_naf_catalog(version: str = "2008") -> dict:
    """Return dictionary of NAF entries for specified version ('2008' or '2025')."""
    return NAF_CATALOG_2025 if str(version) in ("2025", "25") else NAF_CATALOG_2008


def get_naf_info(code: str, version: str = "2008") -> dict:
    """Return dictionary with code, label_fr (official INSEE) and label_en."""
    if not code:
        return {
            "code": "",
            "label_fr": "Activité non spécifiée",
            "label_en": "Unspecified Activity"
        }
    clean_code = code.strip().upper()
    catalog = get_naf_catalog(version)
    if clean_code in catalog:
        return catalog[clean_code]
    # Fallback to other catalog if not found
    other_catalog = NAF_CATALOG_2008 if str(version) in ("2025", "25") else NAF_CATALOG_2025
    if clean_code in other_catalog:
        return other_catalog[clean_code]
    return {
        "code": clean_code,
        "label_fr": f"Activité {clean_code}",
        "label_en": f"Activity {clean_code}"
    }


def get_naf_label_en(code: str, version: str = "2008") -> str:
    """Return descriptive English label for a NAF code."""
    info = get_naf_info(code, version=version)
    return info.get("label_en") or info.get("label_fr") or f"Activity {code}"


def get_naf_label_fr(code: str, version: str = "2008") -> str:
    """Return official INSEE French legal title for a NAF code."""
    info = get_naf_info(code, version=version)
    return info.get("label_fr") or f"Activité {code}"

