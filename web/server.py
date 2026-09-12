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
from web.naf_data import get_naf_label_en

app = Flask(__name__, static_folder="static", template_folder="static")

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
    return send_from_directory(app.static_folder, "index.html")


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
    
    kpis = con.execute(f"""
        SELECT 
            COUNT(*) AS total_active,
            COUNT(CASE WHEN has_coordinates THEN 1 END) AS with_coords,
            COUNT(DISTINCT code_departement) AS total_dept,
            COUNT(DISTINCT code_naf) AS total_naf
        FROM read_parquet('{data_file}')
    """).fetchone()
    
    total_active, with_coords, total_dept, total_naf = kpis
    pct = round(with_coords * 100.0 / total_active, 2) if total_active > 0 else 0
    
    return jsonify({
        "total_active_establishments": total_active,
        "geocoded_establishments": with_coords,
        "geocoding_rate_pct": pct,
        "distinct_departments": total_dept,
        "distinct_naf_codes": total_naf,
        "is_sample": is_sample,
        "source_file": os.path.basename(data_file)
    })


@app.route("/api/departments")
def get_departments():
    data_file, _ = get_active_dataset_path()
    con = get_db()
    
    rows = con.execute(f"""
        WITH dept_stats AS (
            SELECT 
                code_departement,
                COUNT(*) AS total_etablissements,
                COUNT(CASE WHEN has_coordinates THEN 1 END) AS geocoded,
                ROUND(COUNT(CASE WHEN has_coordinates THEN 1 END) * 100.0 / COUNT(*), 1) AS geocoded_pct,
                MODE(code_naf) AS top_naf
            FROM read_parquet('{data_file}')
            WHERE code_departement IS NOT NULL AND code_departement != ''
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
            "name": DEPT_NAMES.get(code, f"Département {code}"),
            "total": r[1],
            "geocoded": r[2],
            "geocoded_pct": r[3],
            "top_naf": r[4],
            "top_naf_label": get_naf_label_en(r[4])
        })
    return jsonify(results)


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
    
    limit = int(request.args.get("limit", 100))
    search = request.args.get("q", "").strip().lower()
    
    rows = con.execute(f"""
        SELECT 
            code_naf,
            COUNT(*) AS total,
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM read_parquet('{data_file}')), 2) AS share_pct
        FROM read_parquet('{data_file}')
        WHERE code_naf IS NOT NULL AND code_naf != ''
        GROUP BY code_naf
        ORDER BY total DESC
    """).fetchall()
    
    results = []
    for r in rows:
        code = str(r[0])
        label = get_naf_label_en(code)
        if search:
            if search not in code.lower() and search not in label.lower():
                continue
        results.append({
            "code": code,
            "label": label,
            "total": r[1],
            "share_pct": r[2]
        })
        if len(results) >= limit:
            break
            
    return jsonify(results)


@app.route("/api/sector/<naf_code>")
def get_sector_distribution(naf_code):
    data_file, _ = get_active_dataset_path()
    con = get_db()
    
    naf_code = naf_code.strip().upper()
    
    # Distribution of this NAF code across all 101 departments
    rows = con.execute(f"""
        SELECT 
            code_departement,
            COUNT(*) AS total
        FROM read_parquet('{data_file}')
        WHERE UPPER(code_naf) = '{naf_code}'
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
        "label": get_naf_label_en(naf_code),
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
    
    return Response(
        csv_data,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=sirene_distribution_naf_departement.csv"}
    )


if __name__ == "__main__":
    port = 8000
    print(f"Starting SIRENE Dashboard server on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
