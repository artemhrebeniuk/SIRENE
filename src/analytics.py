"""
Analytics and aggregation module for Milestone 6:
Establishment counts by NAF code and Department.
"""
import json
import time
import sys
from pathlib import Path
from typing import List, Optional
import duckdb
from rich.console import Console
from rich.table import Table

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from src.config import (
    COMBINED_PARQUET_PATH,
    SUMMARY_NAF_DEPT_CSV,
    SUMMARY_TOP_NAF_CSV,
    SUMMARY_DEPTS_CSV,
    SUMMARY_REPORT_JSON,
)

console = Console()


def compute_aggregations(
    parquet_path: Optional[Path] = None,
    naf_filter: Optional[List[str]] = None,
    top_n: int = 25
) -> dict:
    """
    Compute Milestone 6 aggregations: NAF x Department distribution, top sectors, and department totals.
    """
    source_file = str(parquet_path or COMBINED_PARQUET_PATH).replace("\\", "/")
    
    if not Path(source_file).exists():
        raise FileNotFoundError(f"Processed dataset not found at '{source_file}'. Run pipeline first.")
        
    console.print(f"[bold cyan]Computing Milestone 6 Aggregations from [yellow]{source_file}[/]...[/]")
    start_time = time.time()
    
    con = duckdb.connect()
    con.execute("SET threads = 16;")
    
    # Optional NAF filter clause
    where_naf = ""
    if naf_filter:
        quoted = ", ".join(f"'{code}'" for code in naf_filter)
        where_naf = f"WHERE code_naf IN ({quoted})"
        console.print(f"  • Filter applied: {len(naf_filter)} specific NAF codes")
        
    # 1. Full Matrix: Departement x NAF
    console.print("  • Generating full NAF x Department summary table...")
    con.execute(f"""
        COPY (
            SELECT 
                code_departement,
                code_naf,
                COUNT(*) AS total_etablissements,
                COUNT(CASE WHEN has_coordinates THEN 1 END) AS geocoded_etablissements,
                ROUND(COUNT(CASE WHEN has_coordinates THEN 1 END) * 100.0 / COUNT(*), 2) AS geocoded_pct
            FROM read_parquet('{source_file}')
            {where_naf}
            GROUP BY code_departement, code_naf
            ORDER BY code_departement ASC, total_etablissements DESC
        ) TO '{str(SUMMARY_NAF_DEPT_CSV).replace(chr(92), "/")}' (FORMAT CSV, HEADER);
    """)
    
    # 2. Top NAF Sectors across France
    con.execute(f"""
        COPY (
            SELECT 
                code_naf,
                COUNT(*) AS total_etablissements,
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM read_parquet('{source_file}') {where_naf}), 2) AS share_pct,
                COUNT(DISTINCT code_departement) AS active_in_departments
            FROM read_parquet('{source_file}')
            {where_naf}
            GROUP BY code_naf
            ORDER BY total_etablissements DESC
        ) TO '{str(SUMMARY_TOP_NAF_CSV).replace(chr(92), "/")}' (FORMAT CSV, HEADER);
    """)
    
    # 3. Department totals
    con.execute(f"""
        COPY (
            SELECT 
                code_departement,
                COUNT(*) AS total_etablissements,
                COUNT(DISTINCT code_naf) AS distinct_naf_codes,
                COUNT(CASE WHEN has_coordinates THEN 1 END) AS geocoded_etablissements,
                ROUND(COUNT(CASE WHEN has_coordinates THEN 1 END) * 100.0 / COUNT(*), 2) AS geocoded_pct
            FROM read_parquet('{source_file}')
            {where_naf}
            GROUP BY code_departement
            ORDER BY total_etablissements DESC
        ) TO '{str(SUMMARY_DEPTS_CSV).replace(chr(92), "/")}' (FORMAT CSV, HEADER);
    """)
    
    # 4. Fetch summary KPI numbers for reporting
    overall_kpis = con.execute(f"""
        SELECT 
            COUNT(*) AS total_active,
            COUNT(CASE WHEN has_coordinates THEN 1 END) AS with_coords,
            COUNT(DISTINCT code_departement) AS total_dept,
            COUNT(DISTINCT code_naf) AS total_naf
        FROM read_parquet('{source_file}')
        {where_naf}
    """).fetchone()
    
    top_sectors = con.execute(f"""
        SELECT 
            code_naf,
            total_etablissements,
            share_pct
        FROM read_csv('{str(SUMMARY_TOP_NAF_CSV).replace(chr(92), "/")}')
        LIMIT {top_n}
    """).fetchall()
    
    top_depts = con.execute(f"""
        SELECT 
            code_departement,
            total_etablissements,
            distinct_naf_codes,
            geocoded_pct
        FROM read_csv('{str(SUMMARY_DEPTS_CSV).replace(chr(92), "/")}')
        LIMIT 15
    """).fetchall()
    
    elapsed = time.time() - start_time
    
    report_data = {
        "calculated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_parquet": str(source_file),
        "execution_time_seconds": round(elapsed, 2),
        "kpis": {
            "total_active_establishments": overall_kpis[0],
            "geocoded_establishments": overall_kpis[1],
            "geocoding_rate_pct": round(overall_kpis[1] * 100.0 / overall_kpis[0], 2) if overall_kpis[0] > 0 else 0,
            "distinct_departments": overall_kpis[2],
            "distinct_naf_codes": overall_kpis[3],
        },
        "top_sectors": [{"code_naf": row[0], "count": row[1], "share_pct": row[2]} for row in top_sectors],
        "top_departments": [{"code_departement": row[0], "count": row[1], "distinct_naf": row[2], "geocoded_pct": row[3]} for row in top_depts],
        "files_generated": {
            "naf_by_department_csv": str(SUMMARY_NAF_DEPT_CSV),
            "top_naf_csv": str(SUMMARY_TOP_NAF_CSV),
            "departments_csv": str(SUMMARY_DEPTS_CSV),
        }
    }
    
    with open(SUMMARY_REPORT_JSON, "w", encoding="utf-8") as f:
        json.dump(report_data, f, indent=2, ensure_ascii=False)
        
    console.print(f"[bold green][OK] Aggregations computed in {elapsed:.2f} seconds![/]\n")
    
    # Render Rich Tables
    _render_cli_tables(report_data, top_sectors, top_depts)
    
    return report_data


def _render_cli_tables(report_data: dict, top_sectors: list, top_depts: list):
    """
    Format and print terminal reports.
    """
    kpis = report_data["kpis"]
    
    kpi_table = Table(title="[bold yellow]Milestone 6: French Business Registry Core Statistics[/]", header_style="bold magenta")
    kpi_table.add_column("Metric", style="cyan")
    kpi_table.add_column("Value", style="bold green", justify="right")
    
    kpi_table.add_row("Total Active Establishments", f"{kpis['total_active_establishments']:,}")
    kpi_table.add_row("Geocoded with Coordinates", f"{kpis['geocoded_establishments']:,} ({kpis['geocoding_rate_pct']}%)")
    kpi_table.add_row("Covered Departments", str(kpis["distinct_departments"]))
    kpi_table.add_row("Distinct NAF / APE Activities", str(kpis["distinct_naf_codes"]))
    console.print(kpi_table)
    console.print()
    
    # Top NAF Sectors Table
    sec_table = Table(title="[bold cyan]Top Economic Activities (NAF Codes)[/]", header_style="bold blue")
    sec_table.add_column("#", style="dim", justify="right")
    sec_table.add_column("NAF Code", style="bold yellow")
    sec_table.add_column("Active Establishments", justify="right", style="green")
    sec_table.add_column("Share of Total", justify="right")
    
    for idx, (code, count, share) in enumerate(top_sectors[:15], start=1):
        sec_table.add_row(str(idx), str(code or "N/A"), f"{count:,}", f"{share:.2f}%")
    console.print(sec_table)
    console.print()
    
    # Top Departments Table
    dept_table = Table(title="[bold cyan]Top Departments by Business Volume[/]", header_style="bold blue")
    dept_table.add_column("Dept", style="bold yellow", justify="center")
    dept_table.add_column("Active Establishments", justify="right", style="green")
    dept_table.add_column("Distinct NAF", justify="right")
    dept_table.add_column("Geocoded %", justify="right")
    
    for code, count, naf_cnt, pct in top_depts:
        dept_table.add_row(str(code or "N/A"), f"{count:,}", str(naf_cnt), f"{pct:.1f}%")
    console.print(dept_table)
    console.print(f"\n[bold green]Reports generated in output/:[/]")
    console.print(f"  • {SUMMARY_NAF_DEPT_CSV}")
    console.print(f"  • {SUMMARY_TOP_NAF_CSV}")
    console.print(f"  • {SUMMARY_DEPTS_CSV}")
    console.print(f"  • {SUMMARY_REPORT_JSON}\n")


if __name__ == "__main__":
    compute_aggregations()
