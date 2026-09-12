@echo off
title SIRENE GeoData Observatory
echo ======================================================================
echo   SIRENE GeoData Observatory - Observatoire National des Entreprises
echo   Moteur : Python + DuckDB Spatial
echo ======================================================================
echo.
echo Lancement du serveur sur http://localhost:8000 ...
start http://localhost:8000
python run.py serve --port 8000
pause
