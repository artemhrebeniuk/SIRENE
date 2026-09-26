"""
Flask backend server for SIRENE Interactive Geospatial Dashboard.
Provides high-performance REST APIs powered by DuckDB.
"""
import json
import os
import sys
from pathlib import Path
from typing import Tuple, List, Dict
from flask import Flask, jsonify, request, send_from_directory, Response
import duckdb

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from src.config import (
    BASE_DIR,
    COMBINED_PARQUET_PATH,
    PROCESSED_DATA_DIR,
    SUMMARY_REPORT_JSON,
    SUMMARY_NAF_DEPT_CSV,
    SUMMARY_DEPTS_CSV,
    SUMMARY_TOP_NAF_CSV,
)
from web.naf_data import get_naf_label_en, get_naf_label_fr

app = Flask(__name__, static_folder="static", template_folder="static")
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

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
    """Return path to latest available parquet layer (full or sample)."""
    full_path = COMBINED_PARQUET_PATH
    sample_path = PROCESSED_DATA_DIR / "sample_active_geo.parquet"
    
    if full_path.exists():
        return str(full_path).replace("\\", "/"), False
    elif sample_path.exists():
        return str(sample_path).replace("\\", "/"), True
    else:
        raise FileNotFoundError("No processed dataset found. Run pipeline first.")


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
    return send_from_directory(geojson_path.parent, geojson_path.name)


@app.route("/api/kpis")
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
    
    return jsonify([{
        "code": r[0],
        "label": get_naf_label_en(r[0], version=version),
        "label_fr": get_naf_label_fr(r[0], version=version),
        "version": version,
        "total": r[1]
    } for r in rows])


@app.route("/api/businesses")
def get_businesses():
    data_file, _ = get_active_dataset_path()
    con = get_db()
    
    dept = request.args.get("dept", "").strip().upper()
    city = request.args.get("city", "").strip().upper()
    naf = request.args.get("naf", "").strip().upper()
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
    
    clauses = ["code_departement NOT LIKE '97%'"]
    if dept:
        clauses.append(f"UPPER(code_departement) = '{dept}'")
    if city:
        clauses.append(f"UPPER(libelle_commune) = '{city}'")
    if naf:
        col = "code_naf_2025" if version in ("2025", "25") else "code_naf"
        clauses.append(f"(UPPER({col}) = '{naf}' OR UPPER(code_naf) = '{naf}' OR UPPER(code_naf_2025) = '{naf}')")
    if q:
        clauses.append(f"((denomination NOT IN ('[ND]', '') AND LOWER(denomination) LIKE '%{q}%') OR (enseigne NOT IN ('[ND]', '') AND LOWER(enseigne) LIKE '%{q}%') OR siret LIKE '%{q}%')")
        
    where_sql = "WHERE " + " AND ".join(clauses)
    
    total_count = con.execute(f"""
        SELECT COUNT(*) FROM read_parquet('{data_file}') {where_sql}
    """).fetchone()[0]
    
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
            longitude
        FROM read_parquet('{data_file}')
        {where_sql}
        ORDER BY 
            has_coordinates DESC,
            (denomination NOT IN ('[ND]', '') AND denomination IS NOT NULL) DESC,
            (enseigne NOT IN ('[ND]', '') AND enseigne IS NOT NULL) DESC,
            date_creation DESC NULLS LAST
        LIMIT {limit} OFFSET {offset}
    """).fetchall()
    
    items = []
    for r in rows:
        items.append({
            "siret": r[0],
            "siren": r[1],
            "name": r[2],
            "denomination": r[3],
            "enseigne": r[4],
            "postal_code": r[5],
            "city": r[6],
            "department": r[7],
            "naf_code": r[8],
            "naf_label": get_naf_label_en(r[8], version="2008"),
            "naf_label_fr": get_naf_label_fr(r[8], version="2008"),
            "naf_code_2025": r[9],
            "naf_2025_label": get_naf_label_en(r[9], version="2025") if r[9] else None,
            "naf_2025_label_fr": get_naf_label_fr(r[9], version="2025") if r[9] else None,
            "gov_verify_url": f"https://annuaire-entreprises.data.gouv.fr/etablissement/{r[0]}",
            "google_maps_url": f"https://www.google.com/maps/search/?api=1&query={r[11]},{r[12]}" if (r[11] and r[12]) else None,
            "created_date": str(r[10]) if r[10] else "N/A",
            "lat": r[11],
            "lng": r[12],
            "has_gps": bool(r[11] and r[12])
        })
        
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
        with open(target, "r", encoding="utf-8") as f:
            return Response(f.read(), mimetype="application/json")
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


@app.route("/api/parking/nearby")
def get_nearby_parking():
    """
    Find nearby parking spots around a business location for LED advertising trucks.
    Identifies surface/street parking suitable for large vehicles vs underground structures.
    """
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
        radius = int(request.args.get("radius", 400))
    except (TypeError, ValueError):
        return jsonify({"error": "Valid lat and lon are required"}), 400

    radius = min(max(radius, 50), 1000)
    cache_key = f"{round(lat, 4)}_{round(lon, 4)}_{radius}"
    if cache_key in PARKING_CACHE:
        return jsonify(PARKING_CACHE[cache_key])

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
            return jsonify(response_data)
        else:
            return jsonify({"center": {"lat": lat, "lon": lon}, "count": 0, "parkings": []})
    except Exception as e:
        return jsonify({"center": {"lat": lat, "lon": lon}, "count": 0, "parkings": [], "error": str(e)})


@app.route("/api/crowd/hotspots")
def get_crowd_hotspots():
    """
    Returns curated high-footfall pedestrian zones, major transit hubs and shopping arteries in France.
    """
    hotspots = [
        {"name": "Châtelet - Les Halles", "city": "Paris", "lat": 48.8619, "lon": 2.3470, "intensity": 0.98, "type": "Transit & Shopping"},
        {"name": "Gare Saint-Lazare", "city": "Paris", "lat": 48.8768, "lon": 2.3253, "intensity": 0.95, "type": "Major Commuter Hub"},
        {"name": "Gare du Nord", "city": "Paris", "lat": 48.8809, "lon": 2.3553, "intensity": 0.99, "type": "Europe's Busiest Station"},
        {"name": "Gare de Lyon", "city": "Paris", "lat": 48.8443, "lon": 2.3744, "intensity": 0.94, "type": "TGV & Metro Hub"},
        {"name": "Opéra Garnier / Bd Haussmann", "city": "Paris", "lat": 48.8719, "lon": 2.3316, "intensity": 0.96, "type": "Department Stores & Luxury"},
        {"name": "Champs-Élysées", "city": "Paris", "lat": 48.8698, "lon": 2.3075, "intensity": 0.95, "type": "High Tourist & Footfall Avenue"},
        {"name": "Place de la République", "city": "Paris", "lat": 48.8675, "lon": 2.3638, "intensity": 0.91, "type": "Pedestrian Plaza & Hub"},
        {"name": "Place de la Bastille", "city": "Paris", "lat": 48.8531, "lon": 2.3698, "intensity": 0.89, "type": "Nightlife & Commercial"},
        {"name": "Montparnasse Bienvenüe", "city": "Paris", "lat": 48.8421, "lon": 2.3219, "intensity": 0.92, "type": "Train Hub & Offices"},
        {"name": "Rue de Rivoli", "city": "Paris", "lat": 48.8575, "lon": 2.3514, "intensity": 0.93, "type": "Pedestrian Shopping Strip"},
        {"name": "La Défense Grande Arche", "city": "Paris / Nanterre", "lat": 48.8926, "lon": 2.2361, "intensity": 0.97, "type": "Europe's Largest Business District"},
        {"name": "Lyon Part-Dieu", "city": "Lyon", "lat": 45.7606, "lon": 4.8594, "intensity": 0.94, "type": "TGV Station & Mega Mall"},
        {"name": "Place Bellecour / Rue de la République", "city": "Lyon", "lat": 45.7578, "lon": 4.8320, "intensity": 0.93, "type": "Pedestrian Shopping Spine"},
        {"name": "Marseille Saint-Charles", "city": "Marseille", "lat": 43.3032, "lon": 5.3806, "intensity": 0.91, "type": "Main Rail Station"},
        {"name": "Vieux-Port", "city": "Marseille", "lat": 43.2951, "lon": 5.3744, "intensity": 0.92, "type": "Pedestrian Harbor & Tourism"},
        {"name": "Lille Flandres", "city": "Lille", "lat": 50.6366, "lon": 3.0707, "intensity": 0.88, "type": "Grand Place & Transit Hub"},
        {"name": "Bordeaux Saint-Jean", "city": "Bordeaux", "lat": 44.8259, "lon": -0.5567, "intensity": 0.89, "type": "TGV Hub"},
        {"name": "Rue Sainte-Catherine", "city": "Bordeaux", "lat": 44.8378, "lon": -0.5746, "intensity": 0.95, "type": "Longest Pedestrian Street in Europe"},
        {"name": "Toulouse Capitole", "city": "Toulouse", "lat": 43.6047, "lon": 1.4442, "intensity": 0.91, "type": "Historic Commercial Center"},
        {"name": "Nice Promenade des Anglais / Masséna", "city": "Nice", "lat": 43.6970, "lon": 7.2704, "intensity": 0.92, "type": "Tourist & Coastal Promenade"}
    ]
    return jsonify(hotspots)


@app.route("/api/businesses/map")
def get_businesses_map():
    """
    Returns actual geocoded establishments directly from the official INSEE database
    for interactive map display within a bounding box or for a specific city/commune.
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
    
    try:
        limit = min(int(request.args.get("limit", 60)), 200)
    except (ValueError, TypeError):
        limit = 60

    clauses = ["has_coordinates = true", "latitude IS NOT NULL", "longitude IS NOT NULL", "code_departement NOT LIKE '97%'"]
    if dept:
        clauses.append(f"UPPER(code_departement) = '{dept}'")
    if city:
        clauses.append(f"UPPER(libelle_commune) = '{city}'")
    if naf:
        clauses.append(f"(UPPER(code_naf) = '{naf}' OR UPPER(code_naf_2025) = '{naf}')")
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
            longitude
        FROM read_parquet('{data_file}')
        {where_sql}
        ORDER BY 
            (denomination NOT IN ('[ND]', '') AND denomination IS NOT NULL) DESC,
            (enseigne NOT IN ('[ND]', '') AND enseigne IS NOT NULL) DESC,
            date_creation DESC NULLS LAST
        LIMIT {limit}
    """).fetchall()

    items = []
    for r in rows:
        items.append({
            "siret": r[0],
            "siren": r[1],
            "name": r[2],
            "denomination": r[3],
            "enseigne": r[4],
            "postal_code": r[5],
            "city": r[6],
            "department": r[7],
            "naf_code": r[8],
            "naf_label": get_naf_label_en(r[8], version="2008"),
            "naf_label_fr": get_naf_label_fr(r[8], version="2008"),
            "naf_code_2025": r[9],
            "naf_2025_label": get_naf_label_en(r[9], version="2025") if r[9] else None,
            "naf_2025_label_fr": get_naf_label_fr(r[9], version="2025") if r[9] else None,
            "gov_verify_url": f"https://annuaire-entreprises.data.gouv.fr/etablissement/{r[0]}",
            "google_maps_url": f"https://www.google.com/maps/search/?api=1&query={r[11]},{r[12]}",
            "created_date": str(r[10]) if r[10] else "N/A",
            "lat": r[11],
            "lng": r[12]
        })
    return jsonify({"count": len(items), "items": items})


@app.route("/api/crowd/heatmap")
def get_crowd_heatmap():
    """
    Returns authentic continuous heatmap coordinates [[lat, lon, weight], ...]
    aggregated directly from the French National SIRENE registry (14M+ geocoded businesses).
    """
    try:
        from web.crowd_data import get_crowd_heatmap_points
        min_lat = request.args.get("min_lat")
        max_lat = request.args.get("max_lat")
        min_lon = request.args.get("min_lon")
        max_lon = request.args.get("max_lon")
        if min_lat and max_lat and min_lon and max_lon:
            pts = get_crowd_heatmap_points(
                min_lat=float(min_lat),
                min_lon=float(min_lon),
                max_lat=float(max_lat),
                max_lon=float(max_lon)
            )
        else:
            pts = get_crowd_heatmap_points()
        return jsonify(pts)
    except Exception as e:
        print("Error in /api/crowd/heatmap:", e)
        return jsonify([])


if __name__ == "__main__":
    port = 8000
    print(f"Starting SIRENE Dashboard server on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
