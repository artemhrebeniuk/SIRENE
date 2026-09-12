"""
Master CLI controller for the SIRENE ETL and Geospatial Processing Pipeline.
"""
import argparse
import sys
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
from src.fetcher import check_discovery, fetch_all
from src.pipeline import run_pipeline, build_pipeline_sql
from src.analytics import compute_aggregations

console = Console()


def cmd_discover(args):
    check_discovery()


def cmd_download(args):
    fetch_all(force=args.force)


def cmd_process(args):
    if not STOCK_PARQUET_PATH.exists() or not GEOLOC_PARQUET_PATH.exists():
        console.print("[bold red]Error:[/] Raw parquet datasets not found in data/raw/.")
        console.print("Run [bold cyan]python run.py download[/] first, or run [bold cyan]python run.py sample[/] for quick test.")
        sys.exit(1)
    run_pipeline(
        threads=args.threads,
        memory_limit=args.memory,
        limit=args.limit
    )


def cmd_analyze(args):
    if not COMBINED_PARQUET_PATH.exists():
        console.print("[bold red]Error:[/] Processed combined dataset not found in data/processed/.")
        console.print("Run [bold cyan]python run.py process[/] first.")
        sys.exit(1)
    naf_list = [n.strip() for n in args.naf.split(",")] if args.naf else None
    compute_aggregations(naf_filter=naf_list, top_n=args.top)


def cmd_sample(args):
    """
    Run an end-to-end sample test directly on remote datasets via DuckDB httpfs
    to verify pipeline logic without waiting for full multi-gigabyte downloads.
    """
    import duckdb
    from src.config import PROCESSED_DATA_DIR
    
    console.print("[bold cyan]Running Fast Pipeline Probe (End-to-End Test)...[/]")
    limit = args.limit or 25000
    console.print(f"  • Sample size: [yellow]{limit:,} records[/]")
    
    stock_info, geoloc_info = check_discovery()
    sample_out = PROCESSED_DATA_DIR / "sample_active_geo.parquet"
    
    console.print(f"[bold blue]Executing streaming query over remote Parquet headers...[/]")
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("INSTALL spatial; LOAD spatial;")
    
    sql = build_pipeline_sql(
        stock_source=stock_info["url"],
        geoloc_source=geoloc_info["url"],
        target_output=str(sample_out).replace("\\", "/"),
        limit=limit
    )
    con.execute(sql)
    console.print(f"[bold green][OK] Sample generated at:[/] {sample_out}\n")
    
    console.print("[bold blue]Running analytics on sample...[/]")
    compute_aggregations(parquet_path=sample_out, top_n=10)


def cmd_all(args):
    console.print("[bold magenta]=== STEP 1: DOWNLOADING DATASETS ===[/]\n")
    fetch_all(force=args.force)
    console.print("\n[bold magenta]=== STEP 2: PROCESSING DUCKDB PIPELINE ===[/]\n")
    run_pipeline(threads=args.threads, memory_limit=args.memory)
    console.print("\n[bold magenta]=== STEP 3: COMPUTING MILESTONE 6 AGGREGATIONS ===[/]\n")
    compute_aggregations(top_n=args.top)


def cmd_serve(args):
    from web.server import app
    console.print(f"[bold cyan]Launching SIRENE Interactive Geospatial Dashboard on [green]http://localhost:{args.port}[/]...[/]")
    app.run(host="0.0.0.0", port=args.port, debug=False)


def main():
    parser = argparse.ArgumentParser(
        description="SIRENE French Business Registry Pipeline & Geospatial Analytics"
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # discover
    p_disc = subparsers.add_parser("discover", help="Query data.gouv.fr API for current dataset releases")
    p_disc.set_defaults(func=cmd_discover)
    
    # download
    p_dl = subparsers.add_parser("download", help="Download StockEtablissement and Geoloc parquet files")
    p_dl.add_argument("--force", action="store_true", help="Re-download even if files already exist")
    p_dl.set_defaults(func=cmd_download)
    
    # process
    p_proc = subparsers.add_parser("process", help="Filter active establishments and join with geolocation")
    p_proc.add_argument("--limit", type=int, default=None, help="Limit number of active establishments for quick runs")
    p_proc.add_argument("--threads", type=int, default=16, help="DuckDB execution threads (default: 16)")
    p_proc.add_argument("--memory", type=str, default="12GB", help="DuckDB memory limit (default: 12GB)")
    p_proc.set_defaults(func=cmd_process)
    
    # analyze
    p_an = subparsers.add_parser("analyze", help="Calculate Milestone 6 NAF x Department aggregations")
    p_an.add_argument("--naf", type=str, default=None, help="Comma-separated NAF codes filter (e.g. '56.10A,62.01Z')")
    p_an.add_argument("--top", type=int, default=25, help="Number of top sectors to display")
    p_an.set_defaults(func=cmd_analyze)
    
    # sample
    p_samp = subparsers.add_parser("sample", help="Run fast test probe via remote httpfs (no 3GB download needed)")
    p_samp.add_argument("--limit", type=int, default=50000, help="Number of records to sample (default: 50,000)")
    p_samp.set_defaults(func=cmd_sample)
    
    # all
    p_all = subparsers.add_parser("all", help="Run full pipeline: download -> process -> analyze")
    p_all.add_argument("--force", action="store_true", help="Force re-download")
    p_all.add_argument("--threads", type=int, default=16, help="DuckDB execution threads")
    p_all.add_argument("--memory", type=str, default="12GB", help="DuckDB memory limit")
    p_all.add_argument("--top", type=int, default=25, help="Top sectors to display")
    p_all.set_defaults(func=cmd_all)
    
    # serve
    p_srv = subparsers.add_parser("serve", help="Launch interactive web dashboard")
    p_srv.add_argument("--port", type=int, default=8000, help="Port to listen on (default: 8000)")
    p_srv.set_defaults(func=cmd_serve)
    
    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)
        
    args.func(args)


if __name__ == "__main__":
    main()
