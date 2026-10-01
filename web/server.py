"""
Flask backend server for SIRENE Interactive Geospatial Dashboard.
Provides high-performance REST APIs powered by DuckDB.
"""
import json
import os
import sys
from pathlib import Path
from typing import Tuple, List, Dict, Any
import time
import urllib.request
from flask import Flask, jsonify, request, send_from_directory, Response, g, render_template
import duckdb

ENRICHMENT_CACHE: Dict[str, Dict[str, Any]] = {}

from src.config import (
    BASE_DIR,
    COMBINED_PARQUET_PATH,
    PROCESSED_DATA_DIR,
    SUMMARY_REPORT_JSON,
    SUMMARY_NAF_DEPT_CSV,
    SUMMARY_DEPTS_CSV,
    SUMMARY_TOP_NAF_CSV,
    STOCK_PARQUET_PATH,
)
from src.logger import get_logger, log_duration
from web.naf_data import get_naf_label_en, get_naf_label_fr
from web.lead_scoring import (
    get_workforce_info,
    calculate_lead_ad_score,
    is_ad_priority_niche,
    AD_NICHE_PRESETS,
    INSEE_WORKFORCE_TRANCHES,
)

logger = get_logger("server")

app = Flask(__name__, static_folder="static", template_folder="static")
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["TEMPLATES_AUTO_RELOAD"] = True


@app.before_request
def handle_before_request():
    """Record request start timestamp and log route entry."""
    g.req_start_time = time.perf_counter()
    query_str = f" ? {dict(request.args)}" if request.args else ""
    logger.debug(f"--> {request.method} {request.path}{query_str} from {request.remote_addr}")


@app.after_request
def handle_after_request(response):
    """Log response status, latency in milliseconds, and payload size."""
    start_time = getattr(g, "req_start_time", None)
    latency_ms = (time.perf_counter() - start_time) * 1000 if start_time else 0.0
    content_len = response.calculate_content_length() or 0
    status = response.status_code
    
    msg = f"<-- {request.method} {request.path} {status} | {latency_ms:.2f}ms | {content_len}B"
    if status >= 500:
        logger.error(msg)
    elif status >= 400:
        logger.warning(msg)
    elif request.path.startswith("/api/"):
        logger.info(msg)
    else:
        logger.debug(msg)
        
    return response


from werkzeug.exceptions import HTTPException


@app.route("/favicon.ico")
def favicon():
    return ("", 204)


@app.errorhandler(Exception)
def handle_global_exception(e):
    """Catch-all unhandled exception handler logging full traceback for real errors and returning structured JSON."""
    if isinstance(e, HTTPException):
        logger.warning(f"HTTP {e.code} on {request.method} {request.path}: {e.description}")
        return jsonify({
            "error": e.name,
            "detail": e.description,
            "status": e.code,
            "path": request.path
        }), e.code

    logger.critical(f"Unhandled server exception on {request.method} {request.path}: {e}", exc_info=True)
    return jsonify({
        "error": "Internal Server Error",
        "detail": str(e),
        "type": type(e).__name__,
        "path": request.path
    }), 500

# Map of Department Codes to Names
DEPT_NAMES = {
    "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes",
    "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes", "09": "Ariège", "10": "Aube",
    "11": "Aude", "12": "Aveyron", "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal",
    "16": "Charente", "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "2A": "Corse-du-Sud",
    "2B": "Haute-Corse", "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne",
    "25": "Doubs", "26": "Drôme", "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère",
    "30": "Gard", "31": "Haute-Garonne", "32": "Gers", "33": "Gironde", "34": "Hérault",
    "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire", "38": "Isère", "39": "Jura",
    "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire", "44": "Loire-Atlantique",
    "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère", "49": "Maine-et-Loire",
    "50": "Manche", "51": "Marne", "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle",
    "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord",
    "60": "Oise", "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques",
    "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin", "68": "Haut-Rhin", "69": "Rhône",
    "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie",
    "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres",
    "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse",
    "85": "Vendée", "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne",
    "90": "Territoire de Belfort", "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis",
    "94": "Val-de-Marne", "95": "Val-d'Oise",
    "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion", "976": "Mayotte"
}


def get_active_dataset_path() -> Tuple[str, bool]:
    """
    Return path or URL to active establishments dataset.
    Prioritizes:
    1. Remote parquet URL via PARQUET_URL / DATASET_URL env vars (Cloudflare R2, AWS S3, etc.)
    2. Local full dataset (COMBINED_PARQUET_PATH)
    3. Bundled lightweight demo sample (sample_establishments_geo.parquet)
    """
    remote_url = os.environ.get("PARQUET_URL") or os.environ.get("DATASET_URL")
    if remote_url:
        logger.info(f"Resolved active dataset: remote parquet ({remote_url})")
        return remote_url, False

    full_path = COMBINED_PARQUET_PATH
    if full_path.exists():
        logger.debug(f"Resolved active dataset: full parquet ({full_path})")
        return str(full_path).replace("\\", "/"), False

    sample_path = BASE_DIR / "data" / "sample_establishments_geo.parquet"
    if sample_path.exists():
        logger.info(f"Using bundled sample parquet dataset ({sample_path})")
        return str(sample_path).replace("\\", "/"), True

    logger.critical(f"No processed dataset found! Expected: {full_path}")
    raise FileNotFoundError(f"Processed dataset ({full_path}) not found. Run pipeline first or set PARQUET_URL.")


def get_db():
    con = duckdb.connect()
    con.execute("SET threads = 4;")
    return con


@app.route("/")
def index():
    resp = send_from_directory(app.static_folder, "index.html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


@app.route("/api/geojson")
def get_geojson():
    geojson_path = BASE_DIR / "data" / "france_departements_101.geojson"
    if not geojson_path.exists():
        geojson_path = BASE_DIR / "data" / "france_departements.geojson"
    logger.debug(f"Serving GeoJSON boundary layer from: {geojson_path}")
    return send_from_directory(geojson_path.parent, geojson_path.name)


@app.route("/api/kpis")
@app.route("/api/stats")
def get_kpis():
    data_file, is_sample = get_active_dataset_path()
    con = get_db()
    
    # Mainland France (codes 01 to 95, 2A, 2B)
    kpis = con.execute(f"""
        SELECT 
            COUNT(*) AS total_active,
            COUNT(CASE WHEN has_coordinates THEN 1 END) AS with_coords,
            COUNT(DISTINCT code_departement) AS total_dept,
            COUNT(DISTINCT code_naf) AS total_naf,
            COUNT(DISTINCT code_naf_2025) AS total_naf_2025
        FROM read_parquet('{data_file}')
        WHERE code_departement NOT LIKE '97%'
    """).fetchone()
    
    total_active, with_coords, total_dept, total_naf, total_naf_2025 = kpis
    pct = round(with_coords * 100.0 / total_active, 2) if total_active > 0 else 0
    
    logger.info(
        f"/api/kpis: active={total_active:,}, coords={with_coords:,} ({pct}%), "
        f"depts={total_dept}, naf={total_naf}, naf25={total_naf_2025} (source: {os.path.basename(data_file)})"
    )
    
    return jsonify({
        "total_active_establishments": total_active,
        "geocoded_establishments": with_coords,
        "geocoding_rate_pct": pct,
        "distinct_departments": min(total_dept, 96),
        "distinct_naf_codes": total_naf,
        "distinct_naf_2025_codes": total_naf_2025,
        "is_sample": is_sample,
        "source_file": os.path.basename(data_file)
    })


@app.route("/api/departments")
def get_departments():
    data_file, _ = get_active_dataset_path()
    con = get_db()
    
    # Mainland France only (exclude 97X overseas)
    rows = con.execute(f"""
        WITH dept_stats AS (
            SELECT 
                code_departement,
                COUNT(*) AS total_etablissements,
                COUNT(CASE WHEN has_coordinates THEN 1 END) AS geocoded,
                ROUND(COUNT(CASE WHEN has_coordinates THEN 1 END) * 100.0 / COUNT(*), 1) AS geocoded_pct,
                MODE(code_naf) AS top_naf
            FROM read_parquet('{data_file}')
            WHERE code_departement IS NOT NULL 
              AND code_departement != ''
              AND code_departement NOT LIKE '97%'
            GROUP BY code_departement
            ORDER BY total_etablissements DESC
        )
        SELECT * FROM dept_stats
    """).fetchall()
    
    results = []
    for r in rows:
        code = str(r[0])
        results.append({
            "code": code,
            "name": DEPT_NAMES.get(code, f"Department {code}"),
            "total": r[1],
            "geocoded": r[2],
            "geocoded_pct": r[3],
            "top_naf": r[4],
            "top_naf_label": get_naf_label_en(r[4])
        })
    logger.debug(f"/api/departments: returned aggregates for {len(results)} departments")
    return jsonify(results)


@app.route("/api/department/<dept_code>/cities")
def get_department_cities(dept_code):
    data_file, _ = get_active_dataset_path()
    con = get_db()
    dept_code = dept_code.strip().upper()
    
    rows = con.execute(f"""
        SELECT 
            libelle_commune,
            COUNT(*) AS total,
            COUNT(CASE WHEN has_coordinates THEN 1 END) AS geocoded
        FROM read_parquet('{data_file}')
        WHERE UPPER(code_departement) = '{dept_code}'
          AND libelle_commune IS NOT NULL
        GROUP BY libelle_commune
        ORDER BY total DESC
        LIMIT 25
    """).fetchall()
    
    logger.debug(f"/api/department/{dept_code}/cities: found {len(rows)} top cities")
    return jsonify([{
        "city": r[0],
        "total": r[1],
        "geocoded": r[2]
    } for r in rows])


@app.route("/api/department/<dept_code>/niches")
def get_department_niches(dept_code):
    data_file, _ = get_active_dataset_path()
    con = get_db()
    dept_code = dept_code.strip().upper()
    version = request.args.get("version", request.args.get("naf_version", "2008")).strip()
    col = "code_naf_2025" if version in ("2025", "25") else "code_naf"
    
    rows = con.execute(f"""
        SELECT 
            {col},
            COUNT(*) AS total
        FROM read_parquet('{data_file}')
        WHERE UPPER(code_departement) = '{dept_code}'
          AND {col} IS NOT NULL AND {col} != ''
        GROUP BY {col}
        ORDER BY total DESC
        LIMIT 80
    """).fetchall()
    
    logger.debug(f"/api/department/{dept_code}/niches: version={version} -> found {len(rows)} sectors")
    return jsonify([{
        "code": r[0],
        "label": get_naf_label_en(r[0], version=version),
        "label_fr": get_naf_label_fr(r[0], version=version),
        "version": version,
        "total": r[1]
    } for r in rows])


@app.route("/api/leads/presets")
def get_lead_presets():
    """Returns curated advertising niche presets with metadata and codes."""
    return jsonify(AD_NICHE_PRESETS)


@app.route("/api/businesses")
def get_businesses():
    data_file, _ = get_active_dataset_path()
    con = get_db()
    
    dept = request.args.get("dept", "").strip().upper()
    city = request.args.get("city", "").strip().upper()
    naf = request.args.get("naf", "").strip().upper()
    preset = request.args.get("preset", "").strip().lower()
    has_enseigne_param = request.args.get("has_enseigne", "").strip().lower()
    branch_type = request.args.get("branch_type", "all").strip().lower()
    workforce_filter = request.args.get("workforce", "all").strip().lower()
    version = request.args.get("version", request.args.get("naf_version", "2008")).strip()
    q = request.args.get("q", "").strip().lower()
    try:
        limit = min(int(request.args.get("limit", 50)), 250)
    except (ValueError, TypeError):
        limit = 50
    try:
        offset = max(int(request.args.get("offset", 0)), 0)
    except (ValueError, TypeError):
        offset = 0
    
    is_wf_join = (workforce_filter in ("with_staff", "employers", "10_plus", "50_plus", "micro") and STOCK_PARQUET_PATH.exists())
    prefix = "c." if is_wf_join else ""
    from_table = f"read_parquet('{data_file}') c JOIN '{STOCK_PARQUET_PATH}' s ON c.siret = s.siret" if is_wf_join else f"read_parquet('{data_file}')"

    clauses = [f"{prefix}code_departement NOT LIKE '97%'"]
    if dept:
        clauses.append(f"UPPER({prefix}code_departement) = '{dept}'")
    if city:
        clauses.append(f"UPPER({prefix}libelle_commune) = '{city}'")
    if preset and preset in AD_NICHE_PRESETS:
        preset_codes = ", ".join(f"'{c}'" for c in AD_NICHE_PRESETS[preset]["codes"])
        clauses.append(f"(UPPER({prefix}code_naf) IN ({preset_codes}) OR UPPER({prefix}code_naf_2025) IN ({preset_codes}))")
    elif naf:
        col = f"{prefix}code_naf_2025" if version in ("2025", "25") else f"{prefix}code_naf"
        clauses.append(f"(UPPER({col}) = '{naf}' OR UPPER({prefix}code_naf) = '{naf}' OR UPPER({prefix}code_naf_2025) = '{naf}')")
        
    if has_enseigne_param in ("true", "1", "yes"):
        clauses.append(f"{prefix}enseigne NOT IN ('[ND]', '') AND {prefix}enseigne IS NOT NULL")
        
    if branch_type == "secondary":
        clauses.append(f"substring({prefix}siret, 10, 5) NOT IN ('00010', '00019', '00014', '00011', '00015', '00012', '00013', '00001')")
    elif branch_type == "siege":
        clauses.append(f"substring({prefix}siret, 10, 5) IN ('00010', '00019', '00014', '00011', '00015', '00012', '00013', '00001')")

    if is_wf_join:
        if workforce_filter in ("with_staff", "employers"):
            clauses.append("(s.trancheEffectifsEtablissement NOT IN ('NN', '00', '') OR s.caractereEmployeurEtablissement = 'O')")
        elif workforce_filter == "10_plus":
            clauses.append("s.trancheEffectifsEtablissement IN ('11', '12', '21', '22', '31', '32', '41', '42', '51', '52', '53')")
        elif workforce_filter == "50_plus":
            clauses.append("s.trancheEffectifsEtablissement IN ('21', '22', '31', '32', '41', '42', '51', '52', '53')")
        elif workforce_filter == "micro":
            clauses.append("(s.trancheEffectifsEtablissement IN ('00', 'NN') AND (s.caractereEmployeurEtablissement != 'O' OR s.caractereEmployeurEtablissement IS NULL))")

    if q:
        clauses.append(f"(({prefix}denomination NOT IN ('[ND]', '') AND LOWER({prefix}denomination) LIKE '%{q}%') OR ({prefix}enseigne NOT IN ('[ND]', '') AND LOWER({prefix}enseigne) LIKE '%{q}%') OR {prefix}siret LIKE '%{q}%')")
        
    where_sql = "WHERE " + " AND ".join(clauses)
    
    total_count = con.execute(f"""
        SELECT COUNT(*) FROM {from_table} {where_sql}
    """).fetchone()[0]
    
    col_p = prefix
    rows = con.execute(f"""
        SELECT 
            {col_p}siret,
            {col_p}siren,
            COALESCE(
                CASE WHEN {col_p}denomination NOT IN ('[ND]', '') THEN {col_p}denomination END,
                CASE WHEN {col_p}enseigne NOT IN ('[ND]', '') THEN {col_p}enseigne END,
                'Establishment ' || substring({col_p}siret, 10, 5)
            ) AS name,
            {col_p}denomination,
            {col_p}enseigne,
            {col_p}code_postal,
            {col_p}libelle_commune,
            {col_p}code_departement,
            {col_p}code_naf,
            {col_p}code_naf_2025,
            {col_p}date_creation,
            {col_p}latitude,
            {col_p}longitude,
            {col_p}etat_administratif,
            {col_p}qualite_xy
        FROM {from_table}
        {where_sql}
        ORDER BY 
            {col_p}has_coordinates DESC,
            ({col_p}enseigne NOT IN ('[ND]', '') AND {col_p}enseigne IS NOT NULL) DESC,
            ({col_p}denomination NOT IN ('[ND]', '') AND {col_p}denomination IS NOT NULL) DESC,
            {col_p}date_creation DESC NULLS LAST
        LIMIT {limit} OFFSET {offset}
    """).fetchall()
    
    # Query workforce, siege, and exact street address metadata from raw stock for this batch
    sirets = [r[0] for r in rows]
    wf_map = {}
    if sirets and STOCK_PARQUET_PATH.exists():
        try:
            siret_in = ", ".join(f"'{s}'" for s in sirets)
            wf_rows = con.execute(f"""
                SELECT 
                    siret, 
                    trancheEffectifsEtablissement, 
                    etablissementSiege, 
                    etatAdministratifEtablissement,
                    numeroVoieEtablissement,
                    typeVoieEtablissement,
                    libelleVoieEtablissement,
                    complementAdresseEtablissement,
                    distributionSpecialeEtablissement,
                    caractereEmployeurEtablissement,
                    anneeEffectifsEtablissement
                FROM '{STOCK_PARQUET_PATH}'
                WHERE siret IN ({siret_in})
            """).fetchall()
            for wr in wf_rows:
                num = (wr[4] or "").strip()
                t_voie = (wr[5] or "").strip()
                l_voie = (wr[6] or "").strip()
                street_parts = [p for p in (num, t_voie, l_voie) if p]
                street_addr = " ".join(street_parts) if street_parts else ""
                comp_addr = (wr[7] or "").strip()
                distrib = (wr[8] or "").strip()

                wf_map[wr[0]] = {
                    "tranche": wr[1],
                    "is_siege": bool(wr[2]) if wr[2] is not None else True,
                    "etat": wr[3] or "A",
                    "street_address": street_addr,
                    "complement_address": comp_addr,
                    "distribution_speciale": distrib,
                    "caractere_employeur": wr[9],
                    "annee_effectif": wr[10]
                }
        except Exception as e:
            logger.warning(f"Error querying batch workforce/address metadata: {e}")

    items = []
    for r in rows:
        siret = r[0]
        meta = wf_map.get(siret, {})
        wf_code = meta.get("tranche")
        wf_info = get_workforce_info(wf_code, meta.get("caractere_employeur"), meta.get("annee_effectif"))
        is_siege = meta.get("is_siege", True)
        etat = meta.get("etat", r[13] or "A")
        is_active = (etat == "A")
        has_gps = bool(r[11] and r[12])
        has_enseigne = bool(r[4] and r[4] not in ('[ND]', ''))
        street_address = meta.get("street_address", "")
        complement_address = meta.get("complement_address", "")
        distribution_speciale = meta.get("distribution_speciale", "")
        qual_code = str(r[14] or "")

        # Geocoding accuracy label
        if qual_code == "11":
            ban_precision = "Exact Parcel (BAN 11)"
            ban_level = "parcel"
        elif qual_code == "12":
            ban_precision = "Street Interpolation (BAN 12)"
            ban_level = "street"
        elif qual_code == "21":
            ban_precision = "Town Center (BAN 21)"
            ban_level = "commune"
        else:
            ban_precision = f"BAN Quality {qual_code}" if qual_code else "Estimated"
            ban_level = "approx"

        # Physical presence classification (Actual business site vs legal seat)
        is_mailbox_risk = bool(distribution_speciale and any(k in distribution_speciale.upper() for k in ["BP", "BOITE", "DOMICILIATION"]))
        if is_mailbox_risk:
            presence_type = "mailbox"
            presence_label = "Mailbox / BP Risk"
            presence_desc = "Administrative box or shared postal distribution address"
        elif has_enseigne:
            presence_type = "storefront"
            presence_label = "Physical Storefront"
            presence_desc = "Commercial signboard installed on customer facade"
        elif not is_siege:
            presence_type = "branch"
            presence_label = "Operating Branch"
            presence_desc = "Local physical operating establishment / outlet"
        else:
            presence_type = "siege"
            presence_label = "Headquarters (Siège)"
            presence_desc = "Registered corporate headquarters & legal seat"

        # Calculate lead qualification ad score
        ad_score = calculate_lead_ad_score(
            has_enseigne=has_enseigne,
            is_siege=is_siege,
            workforce_min=wf_info.get("min", 0),
            workforce_max=wf_info.get("max", 0),
            naf_code=r[8],
            has_gps=has_gps,
            is_active=is_active
        )

        street_view_url = (
            f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={r[11]},{r[12]}"
            if has_gps else None
        )

        items.append({
            "siret": siret,
            "siren": r[1],
            "name": r[2],
            "denomination": r[3],
            "enseigne": r[4],
            "has_enseigne": has_enseigne,
            "is_siege": is_siege,
            "branch_type_label": "Headquarters" if is_siege else "Branch",
            "street_address": street_address,
            "complement_address": complement_address,
            "distribution_speciale": distribution_speciale,
            "ban_precision": ban_precision,
            "ban_level": ban_level,
            "presence_type": presence_type,
            "presence_label": presence_label,
            "presence_desc": presence_desc,
            "postal_code": r[5],
            "city": r[6],
            "department": r[7],
            "naf_code": r[8],
            "naf_label": get_naf_label_en(r[8], version="2008"),
            "naf_label_fr": get_naf_label_fr(r[8], version="2008"),
            "naf_code_2025": r[9],
            "naf_2025_label": get_naf_label_en(r[9], version="2025") if r[9] else None,
            "naf_2025_label_fr": get_naf_label_fr(r[9], version="2025") if r[9] else None,
            "gov_verify_url": f"https://annuaire-entreprises.data.gouv.fr/etablissement/{siret}",
            "google_maps_url": f"https://www.google.com/maps/search/?api=1&query={r[11]},{r[12]}" if has_gps else None,
            "street_view_url": street_view_url,
            "created_date": str(r[10]) if r[10] else "N/A",
            "lat": r[11],
            "lng": r[12],
            "has_gps": has_gps,
            "status": "Active" if is_active else "Permanently Closed (Fermé)",
            "is_closed": not is_active,
            "workforce_code": wf_info["code"],
            "workforce_label": wf_info["label_en"],
            "workforce_tier": wf_info["tier"],
            "est_revenue": wf_info["est_revenue"],
            "ad_score": ad_score
        })
        
    logger.info(
        f"/api/businesses: dept='{dept}', city='{city}', naf='{naf}', preset='{preset}', "
        f"has_enseigne='{has_enseigne_param}', branch='{branch_type}', q='{q}', "
        f"offset={offset}, limit={limit} -> matching={total_count:,}, returning={len(items)} items"
    )

    return jsonify({
        "total": total_count,
        "limit": limit,
        "offset": offset,
        "items": items
    })


@app.route("/api/businesses/export")
def export_filtered_businesses():
    import csv, io
    data_file, _ = get_active_dataset_path()
    con = get_db()
    
    dept = request.args.get("dept", "").strip().upper()
    city = request.args.get("city", "").strip().upper()
    naf = request.args.get("naf", "").strip().upper()
    q = request.args.get("q", "").strip().lower()
    
    logger.info(f"/api/businesses/export: CSV export requested (dept='{dept}', city='{city}', naf='{naf}', q='{q}')")

    clauses = ["code_departement NOT LIKE '97%'"]
    if dept:
        clauses.append(f"UPPER(code_departement) = '{dept}'")
    if city:
        clauses.append(f"UPPER(libelle_commune) = '{city}'")
    if naf:
        clauses.append(f"UPPER(code_naf) = '{naf}'")
    if q:
        clauses.append(f"((denomination NOT IN ('[ND]', '') AND LOWER(denomination) LIKE '%{q}%') OR (enseigne NOT IN ('[ND]', '') AND LOWER(enseigne) LIKE '%{q}%') OR siret LIKE '%{q}%')")
        
    where_sql = "WHERE " + " AND ".join(clauses)
    
    rows = con.execute(f"""
        SELECT 
            siret,
            siren,
            COALESCE(
                CASE WHEN denomination NOT IN ('[ND]', '') THEN denomination END,
                CASE WHEN enseigne NOT IN ('[ND]', '') THEN enseigne END,
                'Establishment ' || substring(siret, 10, 5)
            ) AS name,
            code_postal,
            libelle_commune,
            code_departement,
            code_naf,
            latitude,
            longitude,
            date_creation
        FROM read_parquet('{data_file}')
        {where_sql}
        ORDER BY 
            has_coordinates DESC,
            (denomination NOT IN ('[ND]', '') AND denomination IS NOT NULL) DESC,
            (enseigne NOT IN ('[ND]', '') AND enseigne IS NOT NULL) DESC,
            date_creation DESC NULLS LAST
        LIMIT 5000
    """).fetchall()
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "SIRET", "SIREN", "Company / Trade Name", "Postal Code", "City", 
        "Department", "NAF Code", "Industry (EN)", "Legal Activity (FR)",
        "Latitude", "Longitude", "Creation Date", "Gov Verification Link"
    ])
    
    for r in rows:
        writer.writerow([
            r[0], r[1], r[2], r[3], r[4], r[5], r[6],
            get_naf_label_en(r[6]), get_naf_label_fr(r[6]),
            r[7], r[8], r[9],
            f"https://annuaire-entreprises.data.gouv.fr/etablissement/{r[0]}"
        ])
        
    logger.info(f"/api/businesses/export: stream generated with {len(rows)} records for dept='{dept or 'all'}'")
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment;filename=sirene_businesses_{dept or 'all'}.csv"}
    )


@app.route("/api/communes")
def get_communes():
    web_file = os.path.join(BASE_DIR, "web", "top_communes.json")
    out_file = os.path.join(BASE_DIR, "output", "top_communes.json")
    target = web_file if os.path.exists(web_file) else out_file
    if os.path.exists(target):
        logger.debug(f"/api/communes: loading precomputed centroids from {target}")
        with open(target, "r", encoding="utf-8") as f:
            return Response(f.read(), mimetype="application/json")
    logger.warning("/api/communes: top_communes.json file missing in both web/ and output/")
    return jsonify([])


@app.route("/api/commune/<city>")
def get_commune_detail(city):
    data_file, _ = get_active_dataset_path()
    con = get_db()
    dept = request.args.get("dept", "").strip().upper()
    city = city.strip().upper()
    
    where_clause = f"UPPER(libelle_commune) = '{city}'"
    if dept:
        where_clause += f" AND UPPER(code_departement) = '{dept}'"
        
    stats = con.execute(f"""
        SELECT 
            libelle_commune,
            code_departement,
            COUNT(*) AS total,
            COUNT(CASE WHEN has_coordinates THEN 1 END) AS geocoded,
            ROUND(COUNT(CASE WHEN has_coordinates THEN 1 END) * 100.0 / COUNT(*), 1) AS geocoded_pct,
            AVG(latitude) AS lat,
            AVG(longitude) AS lng
        FROM read_parquet('{data_file}')
        WHERE {where_clause}
        GROUP BY libelle_commune, code_departement
        LIMIT 1
    """).fetchone()
    
    if not stats:
        return jsonify({"error": "Commune not found"}), 404
        
    top_sectors = con.execute(f"""
        SELECT 
            code_naf,
            COUNT(*) as cnt
        FROM read_parquet('{data_file}')
        WHERE {where_clause}
          AND code_naf IS NOT NULL
        GROUP BY code_naf
        ORDER BY cnt DESC
        LIMIT 5
    """).fetchall()
    
    return jsonify({
        "city": stats[0],
        "dept": stats[1],
        "total": stats[2],
        "geocoded": stats[3],
        "geocoded_pct": stats[4],
        "lat": stats[5],
        "lng": stats[6],
        "top_sectors": [{
            "code_naf": s[0],
            "count": s[1],
            "pct": round(s[1] * 100.0 / stats[2], 1),
            "label": get_naf_label_en(s[0]),
            "label_fr": get_naf_label_fr(s[0])
        } for s in top_sectors]
    })


@app.route("/api/department/<dept_code>")
def get_department_detail(dept_code):
    data_file, _ = get_active_dataset_path()
    con = get_db()
    
    dept_code = dept_code.strip().upper()
    
    # Department top sectors
    sectors = con.execute(f"""
        SELECT 
            code_naf,
            COUNT(*) AS total,
            ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS pct
        FROM read_parquet('{data_file}')
        WHERE UPPER(code_departement) = '{dept_code}'
        GROUP BY code_naf
        ORDER BY total DESC
        LIMIT 20
    """).fetchall()
    
    # Department KPIs
    dept_kpi = con.execute(f"""
        SELECT 
            COUNT(*) AS total,
            COUNT(CASE WHEN has_coordinates THEN 1 END) AS geocoded,
            COUNT(DISTINCT code_naf) AS naf_count,
            COUNT(DISTINCT code_commune) AS commune_count
        FROM read_parquet('{data_file}')
        WHERE UPPER(code_departement) = '{dept_code}'
    """).fetchone()
    
    sector_list = []
    for s in sectors:
        sector_list.append({
            "code_naf": s[0],
            "label": get_naf_label_en(s[0]),
            "count": s[1],
            "pct": s[2]
        })
        
    return jsonify({
        "code": dept_code,
        "name": DEPT_NAMES.get(dept_code, f"Department {dept_code}"),
        "total": dept_kpi[0] if dept_kpi else 0,
        "geocoded": dept_kpi[1] if dept_kpi else 0,
        "geocoded_pct": round(dept_kpi[1] * 100.0 / dept_kpi[0], 1) if dept_kpi and dept_kpi[0] > 0 else 0,
        "distinct_naf": dept_kpi[2] if dept_kpi else 0,
        "distinct_communes": dept_kpi[3] if dept_kpi else 0,
        "top_sectors": sector_list
    })


@app.route("/api/sectors")
def get_sectors():
    data_file, _ = get_active_dataset_path()
    con = get_db()
    
    limit = int(request.args.get("limit", 150))
    search = request.args.get("q", "").strip().lower()
    version = request.args.get("version", request.args.get("naf_version", "2008")).strip()
    col = "code_naf_2025" if version in ("2025", "25") else "code_naf"
    
    rows = con.execute(f"""
        SELECT 
            {col},
            COUNT(*) AS total,
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM read_parquet('{data_file}')), 2) AS share_pct
        FROM read_parquet('{data_file}')
        WHERE {col} IS NOT NULL AND {col} != ''
        GROUP BY {col}
        ORDER BY total DESC
    """).fetchall()
    
    results = []
    for r in rows:
        code = str(r[0])
        label = get_naf_label_en(code, version=version)
        label_fr = get_naf_label_fr(code, version=version)
        if search:
            if search not in code.lower() and search not in label.lower() and search not in label_fr.lower():
                continue
        results.append({
            "code": code,
            "label": label,
            "label_fr": label_fr,
            "total": r[1],
            "share_pct": r[2],
            "version": version
        })
        if len(results) >= limit:
            break
            
    return jsonify(results)


@app.route("/api/sector/<naf_code>")
def get_sector_distribution(naf_code):
    data_file, _ = get_active_dataset_path()
    con = get_db()
    
    naf_code = naf_code.strip().upper()
    version = request.args.get("version", request.args.get("naf_version", "2008")).strip()
    col = "code_naf_2025" if version in ("2025", "25") else "code_naf"
    
    # Distribution of this NAF code across all departments
    rows = con.execute(f"""
        SELECT 
            code_departement,
            COUNT(*) AS total
        FROM read_parquet('{data_file}')
        WHERE UPPER({col}) = '{naf_code}'
          AND code_departement IS NOT NULL AND code_departement != ''
        GROUP BY code_departement
        ORDER BY total DESC
    """).fetchall()
    
    dept_distribution = {}
    total_national = 0
    for r in rows:
        dept_code = str(r[0])
        count = r[1]
        dept_distribution[dept_code] = count
        total_national += count
        
    return jsonify({
        "code_naf": naf_code,
        "label": get_naf_label_en(naf_code, version=version),
        "label_fr": get_naf_label_fr(naf_code, version=version),
        "version": version,
        "total_national": total_national,
        "departments": dept_distribution
    })


@app.route("/api/export")
def export_csv():
    data_file, _ = get_active_dataset_path()
    con = get_db()
    
    csv_data = con.execute(f"""
        SELECT 
            code_departement,
            code_naf,
            COUNT(*) AS total_etablissements,
            COUNT(CASE WHEN has_coordinates THEN 1 END) AS geocoded_count
        FROM read_parquet('{data_file}')
        GROUP BY code_departement, code_naf
        ORDER BY code_departement, total_etablissements DESC
    """).df().to_csv(index=False)
    
import math
import requests

# In-memory cache for nearby parking queries
PARKING_CACHE: Dict[str, dict] = {}


def calculate_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> int:
    """Calculate distance in meters between two coordinates."""
    R = 6371000  # radius of Earth in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return int(R * c)


def fetch_osm_parking(lat: float, lon: float, radius: int = 400) -> dict:
    """Fetch nearby parking amenities from OpenStreetMap Overpass API mirrors with in-memory caching."""
    radius = min(max(radius, 50), 1000)
    cache_key = f"{round(lat, 4)}_{round(lon, 4)}_{radius}"
    if cache_key in PARKING_CACHE:
        return PARKING_CACHE[cache_key]

    overpass_query = f"""
    [out:json][timeout:8];
    (
      node["amenity"="parking"](around:{radius},{lat},{lon});
      way["amenity"="parking"](around:{radius},{lat},{lon});
    );
    out center 15;
    """
    mirrors = [
        "https://overpass.openstreetmap.fr/api/interpreter",
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter"
    ]
    headers = {"User-Agent": "SIRENE-TruckAd-Platform/1.0"}
    elements = []
    
    for mirror in mirrors:
        try:
            resp = requests.post(mirror, data={"data": overpass_query}, headers=headers, timeout=5)
            if resp.status_code == 200:
                elements = resp.json().get("elements", [])
                break
        except Exception:
            continue
            
    try:
        if elements:
            results = []
            for el in elements:
                tags = el.get("tags", {})
                p_lat = el.get("lat") or el.get("center", {}).get("lat")
                p_lon = el.get("lon") or el.get("center", {}).get("lon")
                if not p_lat or not p_lon:
                    continue
                dist = calculate_distance_m(lat, lon, p_lat, p_lon)
                parking_type = tags.get("parking", "surface")
                maxheight = tags.get("maxheight")
                capacity = tags.get("capacity")
                try:
                    capacity_val = int(capacity) if capacity else None
                except ValueError:
                    capacity_val = None

                is_underground = parking_type in ["underground", "multi-storey", "shed"] or tags.get("layer", "0") in ["-1", "-2", "-3"]
                is_truck_friendly = not is_underground
                if maxheight:
                    try:
                        h = float(maxheight.replace("m", "").strip())
                        if h < 2.6:
                            is_truck_friendly = False
                    except ValueError:
                        pass

                name = tags.get("name") or (f"{tags.get('addr:street', '')} Parking" if tags.get('addr:street') else "Public Parking")
                results.append({
                    "id": el.get("id"),
                    "name": name.strip(),
                    "lat": p_lat,
                    "lon": p_lon,
                    "distance_m": dist,
                    "type": parking_type,
                    "is_underground": is_underground,
                    "is_truck_friendly": is_truck_friendly,
                    "capacity": capacity_val,
                    "fee": tags.get("fee", "unknown"),
                    "maxheight": maxheight
                })

            results.sort(key=lambda x: x["distance_m"])
            response_data = {
                "center": {"lat": lat, "lon": lon},
                "radius": radius,
                "count": len(results),
                "truck_friendly_count": sum(1 for r in results if r["is_truck_friendly"]),
                "parkings": results
            }
            PARKING_CACHE[cache_key] = response_data
            logger.info(f"OSM Parking: lat={lat}, lon={lon}, radius={radius}m -> {len(results)} spots found")
            return response_data
        else:
            return {"center": {"lat": lat, "lon": lon}, "count": 0, "truck_friendly_count": 0, "parkings": []}
    except Exception as e:
        logger.error(f"OSM Parking error for ({lat}, {lon}): {e}", exc_info=True)
        return {"center": {"lat": lat, "lon": lon}, "count": 0, "truck_friendly_count": 0, "parkings": [], "error": str(e)}


@app.route("/api/parking/nearby")
def get_nearby_parking():
    """Find nearby parking spots around a business location for commercial trucks."""
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
        radius = int(request.args.get("radius", 400))
    except (TypeError, ValueError):
        return jsonify({"error": "Valid lat and lon are required"}), 400

    return jsonify(fetch_osm_parking(lat, lon, radius))


def get_establishment_dossier_data(siret: str) -> dict:
    """
    Extracts authentic establishment details, calculates nearest direct competitors,
    and retrieves territorial density stats from DuckDB.
    """
    data_file, _ = get_active_dataset_path()
    con = get_db()
    
    row = con.execute(f"""
        SELECT 
            siret,
            siren,
            COALESCE(
                CASE WHEN denomination NOT IN ('[ND]', '') THEN denomination END,
                CASE WHEN enseigne NOT IN ('[ND]', '') THEN enseigne END,
                'Establishment ' || substring(siret, 10, 5)
            ) AS name,
            denomination,
            enseigne,
            code_postal,
            libelle_commune,
            code_commune,
            code_departement,
            code_naf,
            code_naf_2025,
            date_creation,
            latitude,
            longitude,
            qualite_xy,
            plg_iris,
            plg_qp24,
            etat_administratif
        FROM '{data_file}'
        WHERE siret = '{siret}'
        LIMIT 1;
    """).fetchone()

    is_closed = False
    is_siege = True
    wf_code = None

    street_address = ""
    complement_address = ""
    distribution_speciale = ""

    if not row:
        # Check raw stock if establishment was closed or not yet active in geo parquet
        if STOCK_PARQUET_PATH.exists():
            raw_row = con.execute(f"""
                SELECT 
                    siret,
                    substring(siret, 1, 9) AS siren,
                    COALESCE(
                        CASE WHEN denominationUsuelleEtablissement NOT IN ('[ND]', '') THEN denominationUsuelleEtablissement END,
                        CASE WHEN enseigne1Etablissement NOT IN ('[ND]', '') THEN enseigne1Etablissement END,
                        'Establishment ' || substring(siret, 10, 5)
                    ) AS name,
                    denominationUsuelleEtablissement,
                    enseigne1Etablissement,
                    codePostalEtablissement,
                    libelleCommuneEtablissement,
                    codeCommuneEtablissement,
                    CASE 
                        WHEN starts_with(codeCommuneEtablissement, '97') THEN substring(codeCommuneEtablissement, 1, 3) 
                        ELSE substring(codeCommuneEtablissement, 1, 2) 
                    END AS code_departement,
                    activitePrincipaleEtablissement,
                    activitePrincipaleNAF25Etablissement,
                    dateCreationEtablissement,
                    etatAdministratifEtablissement,
                    trancheEffectifsEtablissement,
                    etablissementSiege,
                    numeroVoieEtablissement,
                    typeVoieEtablissement,
                    libelleVoieEtablissement,
                    complementAdresseEtablissement,
                    distributionSpecialeEtablissement
                FROM '{STOCK_PARQUET_PATH}'
                WHERE siret = '{siret}'
                LIMIT 1;
            """).fetchone()
            if not raw_row:
                return None
            
            is_closed = (raw_row[12] == "F")
            wf_code = raw_row[13]
            is_siege = bool(raw_row[14]) if raw_row[14] is not None else True
            num = (raw_row[15] or "").strip()
            t_voie = (raw_row[16] or "").strip()
            l_voie = (raw_row[17] or "").strip()
            sp = [p for p in (num, t_voie, l_voie) if p]
            street_address = " ".join(sp) if sp else ""
            complement_address = (raw_row[18] or "").strip()
            distribution_speciale = (raw_row[19] or "").strip()

            row = (
                raw_row[0], raw_row[1], raw_row[2], raw_row[3], raw_row[4],
                raw_row[5], raw_row[6], raw_row[7], raw_row[8], raw_row[9],
                raw_row[10], raw_row[11], None, None, "21", "N/A", "Standard",
                raw_row[12]
            )
        else:
            return None
    else:
        # Query workforce tranche, siege, and address from raw stock for active establishment
        if STOCK_PARQUET_PATH.exists():
            wf_res = con.execute(f"""
                SELECT 
                    trancheEffectifsEtablissement, 
                    etablissementSiege, 
                    etatAdministratifEtablissement,
                    numeroVoieEtablissement,
                    typeVoieEtablissement,
                    libelleVoieEtablissement,
                    complementAdresseEtablissement,
                    distributionSpecialeEtablissement,
                    caractereEmployeurEtablissement,
                    anneeEffectifsEtablissement
                FROM '{STOCK_PARQUET_PATH}'
                WHERE siret = '{siret}'
                LIMIT 1;
            """).fetchone()
            if wf_res:
                wf_code = wf_res[0]
                is_siege = bool(wf_res[1]) if wf_res[1] is not None else True
                if wf_res[2] == "F":
                    is_closed = True
                num = (wf_res[3] or "").strip()
                t_voie = (wf_res[4] or "").strip()
                l_voie = (wf_res[5] or "").strip()
                sp = [p for p in (num, t_voie, l_voie) if p]
                street_address = " ".join(sp) if sp else ""
                complement_address = (wf_res[6] or "").strip()
                distribution_speciale = (wf_res[7] or "").strip()
                caractere_employeur = (wf_res[8] or "").strip() if len(wf_res) > 8 else None
                annee_effectif = wf_res[9] if len(wf_res) > 9 else None

    wf_info = get_workforce_info(wf_code, caractere_employeur, annee_effectif)

    siren_candidate = str(row[1]) if (len(row) > 1 and row[1]) else str(siret)[:9]
    financial_info = {}
    if siren_candidate in ENRICHMENT_CACHE:
        financial_info = ENRICHMENT_CACHE[siren_candidate]
    else:
        try:
            url_api = f"https://recherche-entreprises.api.gouv.fr/search?q={siren_candidate}"
            req_api = urllib.request.Request(url_api, headers={"User-Agent": "SirenePlatform/2.0"})
            with urllib.request.urlopen(req_api, timeout=2.5) as resp_api:
                d_api = json.loads(resp_api.read().decode("utf-8"))
                if d_api.get("results"):
                    res_first = d_api["results"][0]
                    fin = res_first.get("finances") or {}
                    l_yr = None
                    l_ca = None
                    l_res = None
                    if fin:
                        yrs = sorted(fin.keys(), reverse=True)
                        if yrs:
                            l_yr = yrs[0]
                            l_ca = fin[l_yr].get("ca")
                            l_res = fin[l_yr].get("resultat_net")
                    dg_list = []
                    for d_dir in (res_first.get("dirigeants") or [])[:4]:
                        n_d = f"{d_dir.get('prenoms', '')} {d_dir.get('nom', '')}".strip()
                        r_d = d_dir.get("qualite", "Dirigeant")
                        dg_list.append({"name": n_d, "role": r_d})
                    financial_info = {
                        "siren": siren_candidate,
                        "turnover": l_ca,
                        "net_profit": l_res,
                        "latest_fiscal_year": l_yr,
                        "dirigeants": dg_list
                    }
                    ENRICHMENT_CACHE[siren_candidate] = financial_info
        except Exception:
            pass

    lat = float(row[12]) if row[12] is not None else 0.0
    lon = float(row[13]) if row[13] is not None else 0.0
    code_naf = row[9] or ""
    code_naf_2025 = row[10] or ""
    code_postal = row[5] or ""
    code_dept = row[8] or ""
    has_enseigne = bool(row[4] and row[4] not in ('[ND]', ''))

    # Top 5 nearest direct competitors with identical NAF code
    competitors = []
    if lat and lon and code_naf:
        comp_rows = con.execute(f"""
            SELECT 
                siret,
                COALESCE(
                    CASE WHEN denomination NOT IN ('[ND]', '') THEN denomination END,
                    CASE WHEN enseigne NOT IN ('[ND]', '') THEN enseigne END,
                    'Establishment ' || substring(siret, 10, 5)
                ) AS name,
                code_postal,
                libelle_commune,
                date_creation,
                latitude,
                longitude,
                ROUND(
                    6371000 * 2 * ASIN(
                        SQRT(
                            POWER(SIN(RADIANS(latitude - {lat}) / 2), 2) +
                            COS(RADIANS({lat})) * COS(RADIANS(latitude)) *
                            POWER(SIN(RADIANS(longitude - {lon}) / 2), 2)
                        )
                    )
                ) AS distance_meters
            FROM '{data_file}'
            WHERE code_naf = '{code_naf}'
              AND siret != '{siret}'
              AND latitude BETWEEN {lat - 0.05} AND {lat + 0.05}
              AND longitude BETWEEN {lon - 0.05} AND {lon + 0.05}
            ORDER BY distance_meters ASC
            LIMIT 5;
        """).fetchall()

        for c in comp_rows:
            competitors.append({
                "siret": c[0],
                "name": c[1],
                "postal_code": c[2] or "",
                "city": c[3] or "",
                "created_year": c[4].year if c[4] else "N/A",
                "distance_m": int(c[7]) if c[7] is not None else 0,
                "lat": float(c[5]),
                "lon": float(c[6])
            })

    # Territorial industry and overall business density stats
    density_stats = {
        "competitors_postal": 0,
        "competitors_dept": 0,
        "total_postal": 0,
        "total_dept": 0
    }
    if code_dept:
        st_row = con.execute(f"""
            SELECT 
                COUNT(*) FILTER (WHERE code_postal = '{code_postal}' AND code_naf = '{code_naf}') as comp_postal,
                COUNT(*) FILTER (WHERE code_departement = '{code_dept}' AND code_naf = '{code_naf}') as comp_dept,
                COUNT(*) FILTER (WHERE code_postal = '{code_postal}') as total_postal,
                COUNT(*) FILTER (WHERE code_departement = '{code_dept}') as total_dept
            FROM '{data_file}'
            WHERE code_departement = '{code_dept}';
        """).fetchone()
        if st_row:
            density_stats["competitors_postal"] = st_row[0] or 0
            density_stats["competitors_dept"] = st_row[1] or 0
            density_stats["total_postal"] = st_row[2] or 0
            density_stats["total_dept"] = st_row[3] or 0

    # Logistics truck parking spots nearby
    parkings = []
    if lat and lon:
        parking_res = fetch_osm_parking(lat, lon, radius=400)
        parkings = parking_res.get("parkings", [])[:3]

    qualite_map = {
        "11": "Quality 11 (Exact House Number)",
        "12": "Quality 12 (Street Interpolation)",
        "21": "Quality 21 (Town Center)"
    }
    ban_quality = qualite_map.get(str(row[14]), f"Quality {row[14]}")

    # Compute lead qualification score
    ad_score = calculate_lead_ad_score(
        has_enseigne=has_enseigne,
        is_siege=is_siege,
        workforce_min=wf_info.get("min", 0),
        workforce_max=wf_info.get("max", 0),
        naf_code=code_naf,
        has_gps=bool(lat and lon),
        is_active=not is_closed
    )

    street_view_url = (
        f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat},{lon}"
        if (lat and lon) else None
    )

    return {
        "siret": row[0],
        "siren": row[1],
        "name": row[2],
        "denomination": row[3],
        "enseigne": row[4],
        "has_enseigne": has_enseigne,
        "is_siege": is_siege,
        "street_address": street_address,
        "complement_address": complement_address,
        "distribution_speciale": distribution_speciale,
        "presence_type": "storefront" if has_enseigne else ("branch" if not is_siege else "siege"),
        "presence_label": "Physical Storefront" if has_enseigne else ("Operating Branch" if not is_siege else "Headquarters (Siège)"),
        "postal_code": row[5],
        "city": row[6],
        "commune_code": row[7],
        "department_code": row[8],
        "department_name": DEPT_NAMES.get(row[8], row[8]),
        "naf_code": code_naf,
        "naf_label": get_naf_label_en(code_naf, version="2008") or "Commercial Entity",
        "naf_code_2025": code_naf_2025,
        "naf_2025_label": get_naf_label_en(code_naf_2025, version="2025") if code_naf_2025 else None,
        "created_date": str(row[11]) if row[11] else "N/A",
        "lat": lat,
        "lon": lon,
        "has_gps": bool(lat and lon),
        "qualite_xy": row[14],
        "ban_quality": ban_quality,
        "iris_district": row[15] or "N/A",
        "zoning_qp24": row[16] or "Standard",
        "status": "Permanently Closed (Fermé)" if is_closed else ("Active" if row[17] == "A" else "Inactive"),
        "is_closed": is_closed,
        "workforce_code": wf_info["code"],
        "workforce_label": wf_info["label_en"],
        "workforce_tier": wf_info["tier"],
        "est_revenue": wf_info["est_revenue"],
        "ad_score": ad_score,
        "turnover": financial_info.get("turnover"),
        "net_profit": financial_info.get("net_profit"),
        "latest_fiscal_year": financial_info.get("latest_fiscal_year"),
        "dirigeants": financial_info.get("dirigeants", []),
        "street_view_url": street_view_url,
        "gov_verify_url": f"https://annuaire-entreprises.data.gouv.fr/etablissement/{row[0]}",
        "competitors": competitors,
        "density_stats": density_stats,
        "parkings": parkings
    }


@app.route("/api/business/<siret>/dossier")
@app.route("/api/dossier/<siret>")
def get_business_dossier_api(siret: str):
    """Returns structured JSON dossier for an establishment."""
    dossier = get_establishment_dossier_data(siret.strip())
    if not dossier:
        return jsonify({"error": "Establishment not found", "siret": siret}), 404
    return jsonify(dossier)


@app.route("/dossier/<siret>")
def view_business_dossier(siret: str):
    """Renders high-fidelity print-ready Location Dossier HTML page."""
    dossier = get_establishment_dossier_data(siret.strip())
    if not dossier:
        return jsonify({"error": "Establishment not found", "siret": siret}), 404
    return render_template("dossier.html", **dossier)


@app.route("/api/dossier/<siret>/pdf")
def download_business_dossier_pdf(siret: str):
    """
    Renders and serves high-fidelity vector PDF for an establishment.
    Uses headless Chromium print-to-pdf pipeline.
    """
    import subprocess
    import os
    from flask import send_file

    siret_clean = siret.strip()
    dossier = get_establishment_dossier_data(siret_clean)
    if not dossier:
        return jsonify({"error": "Establishment not found", "siret": siret}), 404

    cache_dir = Path("/tmp/sirene_pdf_cache")
    cache_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = cache_dir / f"Dossier_{siret_clean}.pdf"

    chrome_binary = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    port = request.host.split(":")[-1] if ":" in request.host else "8000"
    target_url = f"http://127.0.0.1:{port}/dossier/{siret_clean}"

    if os.path.exists(chrome_binary):
        try:
            cmd = [
                chrome_binary,
                "--headless=new",
                f"--print-to-pdf={pdf_path}",
                "--print-to-pdf-no-header",
                target_url
            ]
            subprocess.run(cmd, check=True, timeout=15, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            logger.error(f"Headless Chrome PDF generation failed: {e}")

    if pdf_path.exists():
        company_name = "".join(c for c in dossier.get("name", "Company") if c.isalnum() or c in ("-", "_")).strip() or "Company"
        download_filename = f"Dossier_{siret_clean}_{company_name}.pdf"
        return send_file(
            str(pdf_path),
            as_attachment=True,
            download_name=download_filename,
            mimetype="application/pdf"
        )
    return jsonify({"error": "Failed to generate PDF"}), 500


@app.route("/api/businesses/map")
def get_businesses_map():
    """
    Returns actual geocoded establishments directly from the official INSEE database
    for interactive map display within a bounding box or for a specific city/commune.
    Enriched with physical storefront verification, street address, and commercial signboards.
    """
    data_file, _ = get_active_dataset_path()
    con = get_db()
    
    city = request.args.get("city", "").strip().upper()
    dept = request.args.get("dept", "").strip().upper()
    min_lat = request.args.get("min_lat")
    max_lat = request.args.get("max_lat")
    min_lng = request.args.get("min_lng")
    max_lng = request.args.get("max_lng")
    naf = request.args.get("naf", "").strip().upper()
    preset = request.args.get("preset", "").strip().lower()
    has_enseigne_param = request.args.get("has_enseigne", "").strip().lower()
    branch_type = request.args.get("branch_type", "all").strip().lower()
    q = request.args.get("q", "").strip().lower()
    
    try:
        limit = min(int(request.args.get("limit", 100)), 250)
    except (ValueError, TypeError):
        limit = 100

    clauses = ["has_coordinates = true", "latitude IS NOT NULL", "longitude IS NOT NULL", "code_departement NOT LIKE '97%'"]
    if dept:
        clauses.append(f"UPPER(code_departement) = '{dept}'")
    if city:
        clauses.append(f"UPPER(libelle_commune) = '{city}'")
    if preset and preset in AD_NICHE_PRESETS:
        preset_codes = ", ".join(f"'{c}'" for c in AD_NICHE_PRESETS[preset]["codes"])
        clauses.append(f"(UPPER(code_naf) IN ({preset_codes}) OR UPPER(code_naf_2025) IN ({preset_codes}))")
    elif naf:
        clauses.append(f"(UPPER(code_naf) = '{naf}' OR UPPER(code_naf_2025) = '{naf}')")
        
    if has_enseigne_param in ("true", "1", "yes"):
        clauses.append("enseigne NOT IN ('[ND]', '') AND enseigne IS NOT NULL")
        
    if branch_type == "secondary":
        clauses.append("substring(siret, 10, 5) NOT IN ('00010', '00019', '00014', '00011', '00015', '00012', '00013', '00001')")
    elif branch_type == "siege":
        clauses.append("substring(siret, 10, 5) IN ('00010', '00019', '00014', '00011', '00015', '00012', '00013', '00001')")

    if q:
        clauses.append(f"((denomination NOT IN ('[ND]', '') AND LOWER(denomination) LIKE '%{q}%') OR (enseigne NOT IN ('[ND]', '') AND LOWER(enseigne) LIKE '%{q}%') OR siret LIKE '%{q}%')")

    if min_lat and max_lat and min_lng and max_lng:
        try:
            clauses.append(f"latitude BETWEEN {float(min_lat)} AND {float(max_lat)}")
            clauses.append(f"longitude BETWEEN {float(min_lng)} AND {float(max_lng)}")
        except ValueError:
            pass

    where_sql = "WHERE " + " AND ".join(clauses)
    rows = con.execute(f"""
        SELECT 
            siret,
            siren,
            COALESCE(
                CASE WHEN denomination NOT IN ('[ND]', '') THEN denomination END,
                CASE WHEN enseigne NOT IN ('[ND]', '') THEN enseigne END,
                'Establishment ' || substring(siret, 10, 5)
            ) AS name,
            denomination,
            enseigne,
            code_postal,
            libelle_commune,
            code_departement,
            code_naf,
            code_naf_2025,
            date_creation,
            latitude,
            longitude,
            etat_administratif
        FROM read_parquet('{data_file}')
        {where_sql}
        ORDER BY 
            (enseigne NOT IN ('[ND]', '') AND enseigne IS NOT NULL) DESC,
            (denomination NOT IN ('[ND]', '') AND denomination IS NOT NULL) DESC,
            date_creation DESC NULLS LAST
        LIMIT {limit}
    """).fetchall()

    sirets = [r[0] for r in rows]
    wf_map = {}
    if sirets and STOCK_PARQUET_PATH.exists():
        try:
            siret_in = ", ".join(f"'{s}'" for s in sirets)
            stock_rows = con.execute(f"""
                SELECT 
                    siret, 
                    trancheEffectifsEtablissement, 
                    etablissementSiege, 
                    etatAdministratifEtablissement,
                    numeroVoieEtablissement,
                    typeVoieEtablissement,
                    libelleVoieEtablissement,
                    complementAdresseEtablissement,
                    distributionSpecialeEtablissement
                FROM '{STOCK_PARQUET_PATH}'
                WHERE siret IN ({siret_in})
            """).fetchall()
            for wr in stock_rows:
                num = (wr[4] or "").strip()
                t_voie = (wr[5] or "").strip()
                l_voie = (wr[6] or "").strip()
                street_parts = [p for p in (num, t_voie, l_voie) if p]
                street_addr = " ".join(street_parts) if street_parts else ""
                comp_addr = (wr[7] or "").strip()
                distrib = (wr[8] or "").strip()

                wf_map[wr[0]] = {
                    "tranche": wr[1],
                    "is_siege": bool(wr[2]) if wr[2] is not None else True,
                    "etat": wr[3] or "A",
                    "street_address": street_addr,
                    "complement_address": comp_addr,
                    "distribution_speciale": distrib
                }
        except Exception as e:
            logger.warning(f"Error querying stock for map markers: {e}")

    items = []
    for r in rows:
        siret_val = r[0]
        stk = wf_map.get(siret_val, {})
        has_ens = bool(r[4] and r[4] not in ('[ND]', ''))
        
        is_siege_val = stk.get("is_siege", True if str(siret_val)[-4:] in ('0010', '0019', '0014', '0011', '0015', '0012', '0013', '0001') else False)
        etat_val = stk.get("etat", r[13] or "A")
        is_closed_val = (etat_val == "F")
        street_addr_val = stk.get("street_address", "")
        comp_addr_val = stk.get("complement_address", "")
        distrib_val = stk.get("distribution_speciale", "")

        is_mailbox_risk = False
        addr_all = f"{street_addr_val} {comp_addr_val} {distrib_val}".upper()
        if any(term in addr_all for term in ("BOITE POSTALE", "BP ", "DOMICILIATION", "CEDEX", "CENTRE D AFFAIRES")):
            is_mailbox_risk = True

        if is_closed_val:
            presence_type = "closed"
            presence_label = "Closed Business"
        elif is_mailbox_risk and not has_ens:
            presence_type = "mailbox"
            presence_label = "Mailbox / BP Risk"
        elif has_ens:
            presence_type = "storefront"
            presence_label = "Physical Storefront"
        elif not is_siege_val:
            presence_type = "branch"
            presence_label = "Operating Branch"
        else:
            presence_type = "siege"
            presence_label = "Headquarters"

        lat_val = r[11]
        lng_val = r[12]
        sv_url = f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat_val},{lng_val}"

        items.append({
            "siret": siret_val,
            "siren": r[1],
            "name": r[2],
            "denomination": r[3],
            "enseigne": r[4],
            "has_enseigne": has_ens,
            "is_siege": is_siege_val,
            "is_closed": is_closed_val,
            "presence_type": presence_type,
            "presence_label": presence_label,
            "street_address": street_addr_val,
            "postal_code": r[5],
            "city": r[6],
            "department": r[7],
            "naf_code": r[8],
            "naf_label": get_naf_label_en(r[8], version="2008"),
            "naf_label_fr": get_naf_label_fr(r[8], version="2008"),
            "naf_code_2025": r[9],
            "naf_2025_label": get_naf_label_en(r[9], version="2025") if r[9] else None,
            "naf_2025_label_fr": get_naf_label_fr(r[9], version="2025") if r[9] else None,
            "gov_verify_url": f"https://annuaire-entreprises.data.gouv.fr/etablissement/{siret_val}",
            "google_maps_url": f"https://www.google.com/maps/search/?api=1&query={lat_val},{lng_val}",
            "street_view_url": sv_url,
            "created_date": str(r[10]) if r[10] else "N/A",
            "lat": lat_val,
            "lng": lng_val
        })
    logger.debug(f"/api/businesses/map: dept='{dept}', city='{city}', naf='{naf}' -> returned {len(items)} markers")
    return jsonify({"count": len(items), "items": items})


@app.route("/api/crowd/heatmap")
def get_crowd_heatmap():
    """
    Returns authentic continuous heatmap coordinates [[lat, lon, weight], ...]
    aggregated directly from the French National SIRENE registry (14M+ geocoded businesses).
    """
    try:
        from web.crowd_data import get_crowd_heatmap_points
        min_lat = request.args.get("min_lat") or request.args.get("lat_min")
        max_lat = request.args.get("max_lat") or request.args.get("lat_max")
        min_lon = request.args.get("min_lon") or request.args.get("lon_min")
        max_lon = request.args.get("max_lon") or request.args.get("lon_max")
        if min_lat and max_lat and min_lon and max_lon:
            pts = get_crowd_heatmap_points(
                min_lat=float(min_lat),
                min_lon=float(min_lon),
                max_lat=float(max_lat),
                max_lon=float(max_lon)
            )
            logger.debug(f"/api/crowd/heatmap: local viewport bbox [{min_lat}, {min_lon}, {max_lat}, {max_lon}] -> {len(pts)} points")
        else:
            pts = get_crowd_heatmap_points()
            logger.debug(f"/api/crowd/heatmap: national overview -> {len(pts)} points")
        return jsonify(pts)
    except Exception as e:
        logger.error(f"/api/crowd/heatmap generation failure: {e}", exc_info=True)
        return jsonify([])


@app.route("/api/business/<siret>/enrich")
def enrich_business(siret):
    """
    Fetches real verified financial data, turnover (CA), net profit,
    fiscal year, and executives (Dirigeants / CEO) from the French National Registry API.
    """
    siren = str(siret)[:9]
    if siren in ENRICHMENT_CACHE:
        return jsonify(ENRICHMENT_CACHE[siren])
    
    try:
        url = f"https://recherche-entreprises.api.gouv.fr/search?q={siren}"
        req = urllib.request.Request(url, headers={"User-Agent": "SirenePlatform/2.0"})
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if not data.get("results"):
                return jsonify({"siren": siren, "enriched": False}), 404
            
            res = data["results"][0]
            fin = res.get("finances") or {}
            latest_year = None
            latest_ca = None
            latest_res = None
            if fin:
                years = sorted(fin.keys(), reverse=True)
                if years:
                    latest_year = years[0]
                    latest_ca = fin[latest_year].get("ca")
                    latest_res = fin[latest_year].get("resultat_net")
            
            dirigeants = []
            for d in (res.get("dirigeants") or [])[:4]:
                name = f"{d.get('prenoms', '')} {d.get('nom', '')}".strip()
                role = d.get("qualite", "Dirigeant")
                birth = d.get("annee_de_naissance")
                dirigeants.append({
                    "name": name,
                    "role": role,
                    "birth_year": birth
                })

            result = {
                "siren": siren,
                "siret": str(siret),
                "enriched": True,
                "nom_complet": res.get("nom_complet"),
                "forme_juridique": res.get("nature_juridique"),
                "total_etablissements": res.get("nombre_etablissements_ouverts", 1),
                "latest_fiscal_year": latest_year,
                "turnover": latest_ca,
                "net_profit": latest_res,
                "dirigeants": dirigeants
            }
            ENRICHMENT_CACHE[siren] = result
            return jsonify(result)
    except Exception as e:
        logger.warning(f"Live enrichment failed for SIREN {siren}: {e}")
        return jsonify({"siren": siren, "enriched": False, "error": str(e)}), 200


@app.route("/api/business/<siret>/locations")
def get_business_locations(siret):
    """
    Finds all operating branches and stores of the same enterprise (SIREN),
    allowing users to jump directly to the physical shop rather than the legal registration seat.
    """
    siren = str(siret)[:9]
    data_file, _ = get_active_dataset_path()
    con = get_db()
    
    rows = con.execute(f"""
        SELECT 
            siret,
            denomination,
            enseigne,
            code_postal,
            libelle_commune,
            latitude,
            longitude,
            substring(siret, 10, 5) IN ('00010', '00019', '00014', '00011', '00015', '00012', '00013', '00001') AS is_siege
        FROM read_parquet('{data_file}')
        WHERE siren = '{siren}'
          AND has_coordinates = true
        ORDER BY (enseigne IS NOT NULL AND enseigne NOT IN ('[ND]', '')) DESC, is_siege ASC
        LIMIT 20
    """).fetchall()
    
    locations = []
    for r in rows:
        locations.append({
            "siret": r[0],
            "name": r[1] or r[2] or f"Establishment {r[0][-5:]}",
            "enseigne": r[2],
            "postal_code": r[3],
            "city": r[4],
            "lat": r[5],
            "lng": r[6],
            "is_siege": bool(r[7]),
            "is_current": (r[0] == siret)
        })
    return jsonify({"siren": siren, "count": len(locations), "locations": locations})


if __name__ == "__main__":
    port = 8000
    logger.info(f"Starting SIRENE Dashboard server on http://localhost:{port}")
    print(f"Starting SIRENE Dashboard server on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
