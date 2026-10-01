"""
Lead Scoring and Financial Intelligence Engine for SIRENE.
Provides workforce categorization, estimated turnover brackets,
advertising niche presets, and B2B lead qualification scoring.
"""

from typing import Dict, Any, Optional

INSEE_WORKFORCE_TRANCHES: Dict[str, Dict[str, Any]] = {
    "NN": {
        "label_en": "Pending URSSAF declaration",
        "label_fr": "Non renseigné (En cours)",
        "min": 0,
        "max": 0,
        "tier": "Pending",
        "est_revenue": "< 150k €"
    },
    "00": {
        "label_en": "Solo operator (No salaried staff)",
        "label_fr": "0 salarié (Indépendant)",
        "min": 0,
        "max": 0,
        "tier": "Solo / Freelance",
        "est_revenue": "< 100k €"
    },
    "01": {
        "label_en": "1 to 2 employees",
        "label_fr": "1 à 2 salariés",
        "min": 1,
        "max": 2,
        "tier": "Small (TPE)",
        "est_revenue": "150k € – 350k €"
    },
    "02": {
        "label_en": "3 to 5 employees",
        "label_fr": "3 à 5 salariés",
        "min": 3,
        "max": 5,
        "tier": "Small (TPE)",
        "est_revenue": "350k € – 800k €"
    },
    "03": {
        "label_en": "6 to 9 employees",
        "label_fr": "6 à 9 salariés",
        "min": 6,
        "max": 9,
        "tier": "Small (TPE)",
        "est_revenue": "800k € – 1.8M €"
    },
    "11": {
        "label_en": "10 to 19 employees",
        "label_fr": "10 à 19 salariés",
        "min": 10,
        "max": 19,
        "tier": "Medium (PME)",
        "est_revenue": "1.8M € – 4M €"
    },
    "12": {
        "label_en": "20 to 49 employees",
        "label_fr": "20 à 49 salariés",
        "min": 20,
        "max": 49,
        "tier": "Medium (PME)",
        "est_revenue": "4M € – 10M €"
    },
    "21": {
        "label_en": "50 to 99 employees",
        "label_fr": "50 à 99 salariés",
        "min": 50,
        "max": 99,
        "tier": "Upper Mid (PME)",
        "est_revenue": "10M € – 25M €"
    },
    "22": {
        "label_en": "100 to 199 employees",
        "label_fr": "100 à 199 salariés",
        "min": 100,
        "max": 199,
        "tier": "Large (ETI)",
        "est_revenue": "25M € – 50M €"
    },
    "31": {
        "label_en": "200 to 249 employees",
        "label_fr": "200 à 249 salariés",
        "min": 200,
        "max": 249,
        "tier": "Large (ETI)",
        "est_revenue": "50M € – 75M €"
    },
    "32": {
        "label_en": "250 to 499 employees",
        "label_fr": "250 à 499 salariés",
        "min": 250,
        "max": 499,
        "tier": "Large (ETI)",
        "est_revenue": "75M € – 150M €"
    },
    "41": {
        "label_en": "500 to 999 employees",
        "label_fr": "500 à 999 salariés",
        "min": 500,
        "max": 999,
        "tier": "Corporate (GE)",
        "est_revenue": "150M € – 500M €"
    },
    "42": {
        "label_en": "1,000 to 1,999 employees",
        "label_fr": "1 000 à 1 999 salariés",
        "min": 1000,
        "max": 1999,
        "tier": "Corporate (GE)",
        "est_revenue": "500M €+"
    },
    "51": {
        "label_en": "2,000 to 4,999 employees",
        "label_fr": "2 000 à 4 999 salariés",
        "min": 2000,
        "max": 4999,
        "tier": "Corporate (GE)",
        "est_revenue": "1B €+"
    },
    "52": {
        "label_en": "5,000 to 9,999 employees",
        "label_fr": "5 000 à 9 999 salariés",
        "min": 5000,
        "max": 9999,
        "tier": "Corporate (GE)",
        "est_revenue": "2B €+"
    },
    "53": {
        "label_en": "10,000+ employees",
        "label_fr": "10 000 salariés et plus",
        "min": 10000,
        "max": 99999,
        "tier": "Corporate (GE)",
        "est_revenue": "5B €+"
    }
}

AD_NICHE_PRESETS: Dict[str, Dict[str, Any]] = {
    "horeca": {
        "title": "Restaurants, Bars & Hotels",
        "icon": "restaurant",
        "codes": ["56.10A", "56.10B", "56.10C", "56.30Z", "55.10Z", "56.21Z"]
    },
    "auto": {
        "title": "Automotive, Detailing & Repair",
        "icon": "car",
        "codes": ["45.11Z", "45.20A", "45.20B", "45.19Z", "45.32Z", "45.40Z"]
    },
    "health": {
        "title": "Dental, Medical, Optical & Spas",
        "icon": "health",
        "codes": ["86.23Z", "86.21Z", "86.22C", "47.78A", "96.02A", "96.02B", "86.90D", "86.90E"]
    },
    "realestate": {
        "title": "Real Estate, Interiors & Renovation",
        "icon": "building",
        "codes": ["68.31Z", "43.21A", "43.22A", "43.32A", "43.34Z", "47.59A", "43.99C"]
    },
    "retail": {
        "title": "Boutiques, Fashion & Bakeries",
        "icon": "bag",
        "codes": ["47.71Z", "47.77Z", "47.52A", "47.22Z", "10.71C", "47.24Z", "47.72A", "47.75Z"]
    }
}


def get_workforce_info(
    code: Optional[str], 
    caractere_employeur: Optional[str] = None, 
    annee_effectif: Optional[int] = None
) -> Dict[str, Any]:
    """Resolves INSEE workforce code and employer flag into structured human-readable and financial information."""
    is_declared_employer = (caractere_employeur == 'O')
    
    if code and code in INSEE_WORKFORCE_TRANCHES and code not in ('NN', ''):
        data = dict(INSEE_WORKFORCE_TRANCHES[code])
        data["code"] = code
        data["is_employer"] = True if data["min"] > 0 else is_declared_employer
        data["year"] = annee_effectif
        return data

    if is_declared_employer:
        return {
            "code": code or "O",
            "label_en": f"Declared Employer (1+ staff{f', {annee_effectif}' if annee_effectif else ''})",
            "label_fr": f"Employeur déclaré (1+ salarié{f', {annee_effectif}' if annee_effectif else ''})",
            "min": 1,
            "max": 5,
            "tier": "Small (TPE)",
            "is_employer": True,
            "year": annee_effectif,
            "est_revenue": "250k € – 750k €"
        }

    if code == "00":
        return {
            "code": "00",
            "label_en": "Solo operator (No salaried staff)",
            "label_fr": "Indépendant (0 salarié)",
            "min": 0,
            "max": 0,
            "tier": "Solo / Freelance",
            "is_employer": False,
            "year": annee_effectif,
            "est_revenue": "< 100k €"
        }

    return {
        "code": code or "NN",
        "label_en": "New / Pending URSSAF data",
        "label_fr": "Création récente / En cours",
        "min": 0,
        "max": 0,
        "tier": "TPE / Micro",
        "is_employer": False,
        "year": annee_effectif,
        "est_revenue": "< 150k €"
    }


def is_ad_priority_niche(naf_code: Optional[str]) -> bool:
    """Checks whether an establishment belongs to high-value advertising buyer niches."""
    if not naf_code:
        return False
    clean = naf_code.strip().upper()
    for preset in AD_NICHE_PRESETS.values():
        if clean in preset["codes"]:
            return True
    return False


def calculate_lead_ad_score(
    has_enseigne: bool,
    is_siege: bool,
    workforce_min: int,
    workforce_max: int,
    naf_code: Optional[str],
    has_gps: bool,
    is_active: bool = True
) -> Dict[str, Any]:
    """
    Computes an Ad Potential Qualification Score (0 to 100) for B2B advertising sales.
    Evaluates customer-facing presence, commercial signboard, staff budget capacity, and niche value.
    """
    if not is_active:
        return {
            "score": 0,
            "badge": "Closed Business",
            "grade": "Inactive",
            "color": "#B3261E",
            "reasons": ["Permanently ceased administrative activity (Fermé)"]
        }

    score = 30
    reasons = []

    # 1. Commercial Signboard (Enseigne) over the door (+25)
    if has_enseigne:
        score += 25
        reasons.append("Registered commercial brand signboard (Storefront)")
    else:
        score += 5

    # 2. Secondary operating branch / local establishment (+10)
    if not is_siege:
        score += 10
        reasons.append("Operating branch / local point of sale")
    else:
        score += 5
        reasons.append("Registered headquarters")

    # 3. Workforce budget capacity (+20 for sweet spot 3-49 employees)
    if 3 <= workforce_min <= 49:
        score += 20
        reasons.append("Optimal advertising payroll tier (3–49 staff)")
    elif workforce_min >= 50:
        score += 15
        reasons.append("Corporate budget capability (50+ staff)")
    elif 1 <= workforce_min <= 2:
        score += 12
        reasons.append("Active employer (1–2 staff)")
    else:
        score += 5

    # 4. High-value B2C / High-ticket advertising niche (+15)
    if is_ad_priority_niche(naf_code):
        score += 15
        reasons.append("Prime high-margin advertising niche")

    # 5. Verified WGS84 Geocoding (+5)
    if has_gps:
        score += 5

    final_score = min(score, 100)

    if final_score >= 80:
        badge = "Hot Lead"
        icon = "flame"
        grade = "Hot"
        color = "#1B5E20"
    elif final_score >= 60:
        badge = "Qualified Lead"
        icon = "bolt"
        grade = "Warm"
        color = "#F57C00"
    else:
        badge = "Standard Target"
        icon = "check"
        grade = "Standard"
        color = "#6750A4"

    return {
        "score": final_score,
        "badge": badge,
        "icon": icon,
        "grade": grade,
        "color": color,
        "reasons": reasons
    }
