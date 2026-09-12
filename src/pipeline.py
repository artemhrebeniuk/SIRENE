"""
DuckDB high-performance ETL pipeline for filtering active establishments,
joining geolocation, and producing the unified active geospatial parquet layer.
"""
import time
import sys
from pathlib import Path
from typing import Optional
import duckdb
from rich.console import Console

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from src.config import (
    STOCK_PARQUET_PATH,
    GEOLOC_PARQUET_PATH,
    COMBINED_PARQUET_PATH,
)

console = Console()


def build_pipeline_sql(
    stock_source: str,
    geoloc_source: str,
    target_output: Optional[str] = None,
    limit: Optional[int] = None,
    sample_rate: Optional[float] = None,
) -> str:
    """
    Construct the DuckDB SQL query to filter active establishments and join with geolocation.
    """
    sample_clause = f"USING SAMPLE {sample_rate * 100}%" if sample_rate else ""
    limit_clause = f"LIMIT {limit}" if limit else ""
    
    query = f"""
    WITH active_stock AS (
        SELECT 
            siret,
            substring(siret, 1, 9) AS siren,
            etatAdministratifEtablissement AS etat_administratif,
            activitePrincipaleEtablissement AS code_naf,
            activitePrincipaleNAF25Etablissement AS code_naf_2025,
            codeCommuneEtablissement AS code_commune_stock,
            codePostalEtablissement AS code_postal,
            libelleCommuneEtablissement AS libelle_commune,
            denominationUsuelleEtablissement AS denomination,
            enseigne1Etablissement AS enseigne,
            dateCreationEtablissement AS date_creation
        FROM read_parquet('{stock_source}') {sample_clause}
        WHERE etatAdministratifEtablissement = 'A'
        {limit_clause}
    ),
    geoloc AS (
        SELECT
            siret,
            x AS x_proj,
            y AS y_proj,
            epsg,
            qualite_xy,
            plg_code_commune,
            x_longitude AS longitude,
            y_latitude AS latitude,
            plg_iris,
            plg_qp24
        FROM read_parquet('{geoloc_source}')
    ),
    combined AS (
        SELECT
            s.siret,
            s.siren,
            s.etat_administratif,
            s.code_naf,
            s.code_naf_2025,
            s.date_creation,
            COALESCE(g.plg_code_commune, s.code_commune_stock) AS code_commune,
            CASE 
                WHEN starts_with(COALESCE(g.plg_code_commune, s.code_commune_stock), '97') 
                     THEN substring(COALESCE(g.plg_code_commune, s.code_commune_stock), 1, 3)
                ELSE substring(COALESCE(g.plg_code_commune, s.code_commune_stock), 1, 2)
            END AS code_departement,
            s.code_postal,
            s.libelle_commune,
            s.denomination,
            s.enseigne,
            g.longitude,
            g.latitude,
            g.x_proj,
            g.y_proj,
            g.epsg,
            g.qualite_xy,
            g.plg_iris,
            g.plg_qp24,
            CASE WHEN g.longitude IS NOT NULL AND g.latitude IS NOT NULL THEN TRUE ELSE FALSE END AS has_coordinates
        FROM active_stock s
        LEFT JOIN geoloc g ON s.siret = g.siret
    )
    SELECT * FROM combined
    """
    if target_output:
        return f"""
        COPY (
            {query}
        ) TO '{target_output}' (FORMAT PARQUET, COMPRESSION ZSTD);
        """
    return query


def run_pipeline(
    stock_path: Optional[Path] = None,
    geoloc_path: Optional[Path] = None,
    output_path: Optional[Path] = None,
    threads: int = 16,
    memory_limit: str = "12GB",
    limit: Optional[int] = None
) -> Path:
    """
    Execute DuckDB ETL pipeline to generate active establishments geospatial layer.
    """
    stock_file = str(stock_path or STOCK_PARQUET_PATH).replace("\\", "/")
    geoloc_file = str(geoloc_path or GEOLOC_PARQUET_PATH).replace("\\", "/")
    out_file = str(output_path or COMBINED_PARQUET_PATH).replace("\\", "/")
    
    Path(out_file).parent.mkdir(parents=True, exist_ok=True)
    
    console.print(f"[bold cyan]Starting DuckDB Processing Pipeline...[/]")
    console.print(f"  • Stock Source: [yellow]{stock_file}[/]")
    console.print(f"  • Geoloc Source: [yellow]{geoloc_file}[/]")
    console.print(f"  • Destination: [green]{out_file}[/]")
    console.print(f"  • Configuration: {threads} threads, {memory_limit} memory limit\n")
    
    start_time = time.time()
    
    con = duckdb.connect()
    con.execute(f"SET threads = {threads};")
    con.execute(f"SET memory_limit = '{memory_limit}';")
    con.execute("INSTALL spatial; LOAD spatial;")
    
    sql = build_pipeline_sql(
        stock_source=stock_file,
        geoloc_source=geoloc_file,
        target_output=out_file,
        limit=limit
    )
    
    con.execute(sql)
    elapsed = time.time() - start_time
    
    # Get statistics from generated output
    stats = con.execute(f"""
        SELECT 
            COUNT(*) AS total_active,
            COUNT(CASE WHEN has_coordinates THEN 1 END) AS with_coords,
            COUNT(DISTINCT code_departement) AS total_dept,
            COUNT(DISTINCT code_naf) AS total_naf
        FROM read_parquet('{out_file}')
    """).fetchone()
    
    total_active, with_coords, total_dept, total_naf = stats
    coord_pct = (with_coords / total_active * 100) if total_active > 0 else 0
    
    console.print(f"[bold green][OK] Pipeline completed in {elapsed:.2f} seconds![/]")
    console.print(f"  • Active Establishments: [bold]{total_active:,}[/]")
    console.print(f"  • Successfully Geocoded: [bold]{with_coords:,} ({coord_pct:.1f}%)[/]")
    console.print(f"  • Distinct Departments: [bold]{total_dept}[/]")
    console.print(f"  • Distinct NAF Codes: [bold]{total_naf}[/]")
    console.print(f"  • Output Size: [bold]{Path(out_file).stat().st_size / (1024*1024):.2f} MB[/]\n")
    
    return Path(out_file)


if __name__ == "__main__":
    run_pipeline()
