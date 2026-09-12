"""
Official NAF (Nomenclature of French Activities) dictionary.
Source: INSEE Official NAF 2008 Revision 2 (738 codes).
Provides both 100% legal official French designations and English industry titles.
"""

import json
import os

NAF_CATALOG = {}
NAF_JSON_PATH = os.path.join(os.path.dirname(__file__), 'naf_complete.json')

if os.path.exists(NAF_JSON_PATH):
    with open(NAF_JSON_PATH, 'r', encoding='utf-8') as f:
        NAF_CATALOG = json.load(f)


def get_naf_info(code: str) -> dict:
    """Return dictionary with code, label_fr (official INSEE) and label_en."""
    if not code:
        return {
            "code": "",
            "label_fr": "Activité non spécifiée",
            "label_en": "Unspecified Activity"
        }
    clean_code = code.strip().upper()
    if clean_code in NAF_CATALOG:
        return NAF_CATALOG[clean_code]
    return {
        "code": clean_code,
        "label_fr": f"Activité {clean_code}",
        "label_en": f"Activity {clean_code}"
    }


def get_naf_label_en(code: str) -> str:
    """Return descriptive English label for a NAF code."""
    info = get_naf_info(code)
    return info.get("label_en") or info.get("label_fr") or f"Activity {code}"


def get_naf_label_fr(code: str) -> str:
    """Return official INSEE French legal title for a NAF code."""
    info = get_naf_info(code)
    return info.get("label_fr") or f"Activité {code}"
