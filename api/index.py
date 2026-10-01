"""
Vercel Serverless Function entrypoint for SIRENE.
Exposes Flask WSGI application callable `app` to the Vercel Python runtime.
"""
import sys
from pathlib import Path

# Ensure project root is in Python import path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from web.server import app

# WSGI application callable for Vercel
# Handled automatically by @vercel/python
