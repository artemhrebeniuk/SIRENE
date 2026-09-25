#!/usr/bin/env bash
# SIRENE GeoData Observatory — Startup Script for macOS / Linux
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================================"
echo "  SIRENE GeoData Observatory — National French Business Registry"
echo "  Moteur : Python 3.12 + DuckDB Spatial"
echo "======================================================================"
echo ""

# Activate virtual environment if present
if [ -d "$SCRIPT_DIR/.venv" ]; then
    source "$SCRIPT_DIR/.venv/bin/activate"
fi

PORT="${1:-8000}"
echo "Lancement du serveur sur http://localhost:${PORT} ..."
python run.py serve --port "$PORT"
