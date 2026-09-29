"""
Module for discovering and downloading latest SIRENE and Geolocation parquet datasets via data.gouv.fr API.
"""
import hashlib
import os
import sys
import time
import requests
from pathlib import Path
from typing import Dict, Optional, Tuple
from tqdm import tqdm
from rich.console import Console

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from src.config import (
    DATA_GOUV_API_BASE,
    DATASET_STOCK,
    DATASET_GEOLOC,
    STOCK_PARQUET_PATH,
    GEOLOC_PARQUET_PATH,
)
from src.logger import get_logger, log_duration

console = Console()
logger = get_logger("fetcher")


def discover_parquet_resource(dataset_slug: str, title_keyword: str) -> Dict[str, any]:
    """
    Query data.gouv.fr API to discover the latest resource matching title_keyword and format parquet.
    """
    api_url = f"{DATA_GOUV_API_BASE}/datasets/{dataset_slug}/"
    headers = {"User-Agent": "SIRENE-Pipeline/1.0"}
    logger.info(f"Querying data.gouv.fr API for dataset: '{dataset_slug}' (keyword: '{title_keyword}')")
    
    response = requests.get(api_url, headers=headers, timeout=30)
    response.raise_for_status()
    data = response.json()
    
    resources = data.get("resources", [])
    logger.debug(f"API returned {len(resources)} total resources for '{dataset_slug}'")
    
    # Filter candidates by format 'parquet' and exact dataset target
    candidates = []
    for res in resources:
        fmt = (res.get("format") or "").lower()
        title = (res.get("title") or "").lower()
        url = (res.get("url") or "").lower()
        
        if "parquet" in fmt or url.endswith(".parquet"):
            if title_keyword.lower() == "stocketablissement":
                # Must match StockEtablissement but NOT Historique or LiensSuccession or Doublons
                if ("stocketablissement" in title or "stocketablissement" in url) and \
                   ("historique" not in title and "historique" not in url) and \
                   ("succession" not in title and "succession" not in url) and \
                   ("doublon" not in title and "doublon" not in url):
                    candidates.append(res)
            elif title_keyword.lower() in title or title_keyword.lower() in url:
                candidates.append(res)
                
    if not candidates:
        logger.error(f"No parquet resource found for dataset '{dataset_slug}' with keyword '{title_keyword}'")
        raise ValueError(
            f"No parquet resource found for dataset '{dataset_slug}' with keyword '{title_keyword}'"
        )
        
    logger.info(f"Discovered {len(candidates)} matching Parquet candidate(s) for '{title_keyword}'")

    # Sort by created_at / last_modified descending to take the freshest
    candidates.sort(
        key=lambda r: r.get("last_modified") or r.get("created_at") or "",
        reverse=True
    )
    
    latest = candidates[0]
    result = {
        "id": latest.get("id"),
        "title": latest.get("title"),
        "url": latest.get("url"),
        "filesize": latest.get("filesize"),
        "last_modified": latest.get("last_modified"),
        "checksum": latest.get("checksum", {}).get("value") if latest.get("checksum") else None,
        "checksum_type": latest.get("checksum", {}).get("type") if latest.get("checksum") else None,
    }
    size_mb = (result["filesize"] or 0) / (1024 * 1024)
    logger.info(f"Selected freshest resource: '{result['title']}' | {size_mb:.2f} MB | Modified: {result['last_modified']} | URL: {result['url']}")
    return result


def download_file(
    url: str,
    target_path: Path,
    expected_size: Optional[int] = None,
    expected_sha1: Optional[str] = None,
    chunk_size: int = 1024 * 1024 * 4  # 4MB chunks
) -> Path:
    """
    Download file with streaming progress bar, resume capability, and sha1 validation.
    """
    target_path = Path(target_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    
    temp_path = target_path.with_suffix(target_path.suffix + ".part")
    headers = {"User-Agent": "SIRENE-Pipeline/1.0"}
    downloaded_bytes = 0
    
    max_retries = 5
    retry_count = 0
    
    logger.info(f"Initiating download: target={target_path.name} | expected_size={expected_size} bytes")

    while retry_count < max_retries:
        try:
            # If final target already exists and size matches, check if complete
            if target_path.exists():
                actual_size = target_path.stat().st_size
                if expected_size and actual_size == expected_size:
                    logger.info(f"File verified locally, skipping download: {target_path} ({actual_size / (1024*1024):.1f} MB)")
                    console.print(f"[bold green][OK][/] File already exists and matches expected size: {target_path.name} ({actual_size / (1024*1024):.1f} MB)")
                    return target_path

            # Check partial download for resuming
            headers = {"User-Agent": "SIRENE-Pipeline/1.0"}
            downloaded_bytes = 0
            if temp_path.exists():
                downloaded_bytes = temp_path.stat().st_size
                headers["Range"] = f"bytes={downloaded_bytes}-"
                logger.info(f"Resuming partial download from byte {downloaded_bytes} ({downloaded_bytes / (1024*1024):.1f} MB)")
                console.print(f"[yellow]Resuming download from byte {downloaded_bytes} ({downloaded_bytes / (1024*1024):.1f} MB)...[/]")

            response = requests.get(url, headers=headers, stream=True, timeout=60)
            if response.status_code == 416 and temp_path.exists():
                # Range not satisfiable - check if file is complete
                if expected_size and temp_path.stat().st_size == expected_size:
                    if target_path.exists():
                        target_path.unlink()
                    temp_path.rename(target_path)
                    logger.info(f"Partial file was already complete, renamed to {target_path}")
                    return target_path
            response.raise_for_status()
            
            # Check if range is accepted
            mode = "ab" if downloaded_bytes > 0 and response.status_code == 206 else "wb"
            if mode == "wb":
                downloaded_bytes = 0
                
            total_size = expected_size or int(response.headers.get("content-length", 0)) + downloaded_bytes
            logger.debug(f"HTTP {response.status_code} | mode={mode} | target_total={total_size} bytes")
            
            with open(temp_path, mode) as f:
                with tqdm(
                    total=total_size,
                    initial=downloaded_bytes,
                    unit="B",
                    unit_scale=True,
                    unit_divisor=1024,
                    desc=target_path.name,
                    ncols=100
                ) as bar:
                    for chunk in response.iter_content(chunk_size=chunk_size):
                        if chunk:
                            f.write(chunk)
                            bar.update(len(chunk))
                            
            # Verify file size if expected_size is known
            if temp_path.exists():
                final_size = temp_path.stat().st_size
                if expected_size and final_size != expected_size:
                    logger.error(f"Size verification failed: got {final_size} bytes, expected {expected_size}")
                    raise IOError(f"File size mismatch: got {final_size} bytes, expected {expected_size}")
                if target_path.exists():
                    target_path.unlink()
                temp_path.rename(target_path)
                logger.info(f"Download validated and finalized: {target_path} ({final_size / (1024*1024):.2f} MB)")
                
            console.print(f"[bold green][OK] Download complete:[/] {target_path}")
            return target_path
            
        except (requests.exceptions.RequestException, IOError) as e:
            retry_count += 1
            logger.warning(f"Download interrupted ({type(e).__name__}: {e}). Retry {retry_count}/{max_retries} scheduled in 3s...", exc_info=True)
            console.print(f"[bold red]Download interrupted ({e}).[/] Retrying {retry_count}/{max_retries} in 3s...")
            time.sleep(3)
            
    logger.critical(f"Failed to download {url} after {max_retries} attempts.")
    raise RuntimeError(f"Failed to download {url} after {max_retries} attempts.")


def check_discovery() -> Tuple[Dict, Dict]:
    """
    Check current available versions from data.gouv.fr.
    """
    console.print("[bold blue]Querying data.gouv.fr API for current Parquet resources...[/]")
    stock_info = discover_parquet_resource(DATASET_STOCK, "StockEtablissement")
    geoloc_info = discover_parquet_resource(DATASET_GEOLOC, "géolocalisation")
    
    console.print("\n[bold]1. StockEtablissement Parquet:[/] ")
    console.print(f"  Title: {stock_info['title']}")
    console.print(f"  URL: {stock_info['url']}")
    console.print(f"  Size: {stock_info['filesize'] / (1024*1024):.2f} MB")
    console.print(f"  Updated: {stock_info['last_modified']}")
    
    console.print("\n[bold]2. Géolocalisation Parquet:[/] ")
    console.print(f"  Title: {geoloc_info['title']}")
    console.print(f"  URL: {geoloc_info['url']}")
    console.print(f"  Size: {geoloc_info['filesize'] / (1024*1024):.2f} MB")
    console.print(f"  Updated: {geoloc_info['last_modified']}\n")
    
    return stock_info, geoloc_info


def fetch_all(force: bool = False) -> Tuple[Path, Path]:
    """
    Fetch both StockEtablissement and Géolocalisation datasets.
    """
    logger.info("fetch_all: Starting batch discovery and download workflow")
    stock_info, geoloc_info = check_discovery()
    
    console.print("[bold cyan]Starting download of StockEtablissement Parquet...[/]")
    stock_path = download_file(
        url=stock_info["url"],
        target_path=STOCK_PARQUET_PATH,
        expected_size=stock_info["filesize"],
        expected_sha1=stock_info["checksum"]
    )
    
    console.print("\n[bold cyan]Starting download of Géolocalisation Parquet...[/]")
    geoloc_path = download_file(
        url=geoloc_info["url"],
        target_path=GEOLOC_PARQUET_PATH,
        expected_size=geoloc_info["filesize"],
        expected_sha1=geoloc_info["checksum"]
    )
    
    logger.info(f"fetch_all completed: stock={stock_path} ({stock_path.stat().st_size} bytes), geoloc={geoloc_path} ({geoloc_path.stat().st_size} bytes)")
    return stock_path, geoloc_path


if __name__ == "__main__":
    check_discovery()
