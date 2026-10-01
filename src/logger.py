"""
Centralized logging architecture for the SIRENE French Enterprise Registry platform.
Provides standardized, structured, high-visibility logging for backend ETL pipelines,
DuckDB analytical operations, Flask web server, and REST API endpoints.
"""

import os
import sys
import time
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional
from contextlib import contextmanager

# Project root directory computed directly to avoid circular imports
BASE_DIR = Path(__file__).resolve().parent.parent

# Directory for persistent server and pipeline logs
LOGS_DIR = BASE_DIR / "logs"
try:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
except (OSError, PermissionError):
    pass
LOG_FILE_PATH = LOGS_DIR / "sirene.log"

# Default log format with millisecond precision, module, function name, and line numbers
DEFAULT_LOG_FORMAT = (
    "%(asctime)s.%(msecs)03d | %(levelname)-7s | %(name)s:%(funcName)s:%(lineno)d - %(message)s"
)
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# ANSI Color codes for console output
_COLORS = {
    logging.DEBUG: "\033[36m",     # Cyan
    logging.INFO: "\033[32m",      # Green
    logging.WARNING: "\033[33m",   # Yellow
    logging.ERROR: "\033[31m",     # Red
    logging.CRITICAL: "\033[1;31m" # Bold Red
}
_RESET = "\033[0m"


class ColoredConsoleFormatter(logging.Formatter):
    """Formatter adding ANSI color codes to log levels for clear terminal diagnostics."""
    def format(self, record):
        color = _COLORS.get(record.levelno, "")
        original_levelname = record.levelname
        if color and sys.stdout.isatty():
            record.levelname = f"{color}{record.levelname:<7}{_RESET}"
        formatted = super().format(record)
        record.levelname = original_levelname
        return formatted


_INITIALIZED = False


def setup_logging(
    level: Optional[str] = None,
    log_to_file: bool = True,
    log_file: Optional[Path] = None
) -> logging.Logger:
    """
    Initializes the root SIRENE logging hierarchy with dual console and rotating file outputs.
    Respects SIRENE_LOG_LEVEL environment variable if present.
    """
    global _INITIALIZED
    
    env_level = os.environ.get("SIRENE_LOG_LEVEL", "INFO").upper()
    log_level_str = (level or env_level).upper()
    log_level = getattr(logging, log_level_str, logging.INFO)

    root_logger = logging.getLogger("sirene")
    root_logger.setLevel(log_level)

    # Avoid adding duplicate handlers on multiple calls
    if not _INITIALIZED:
        # 1. Console Handler
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(log_level)
        console_formatter = ColoredConsoleFormatter(DEFAULT_LOG_FORMAT, datefmt=DATE_FORMAT)
        console_handler.setFormatter(console_formatter)
        root_logger.addHandler(console_handler)

        # 2. Rotating File Handler (10MB per file, up to 5 backups)
        is_serverless = os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
        if log_to_file and not is_serverless:
            target_file = log_file or LOG_FILE_PATH
            try:
                target_file.parent.mkdir(parents=True, exist_ok=True)
                file_handler = RotatingFileHandler(
                    target_file,
                    maxBytes=10 * 1024 * 1024,
                    backupCount=5,
                    encoding="utf-8"
                )
                file_handler.setLevel(log_level)
                file_formatter = logging.Formatter(DEFAULT_LOG_FORMAT, datefmt=DATE_FORMAT)
                file_handler.setFormatter(file_formatter)
                root_logger.addHandler(file_handler)
            except Exception as e:
                sys.stderr.write(f"Warning: Failed to initialize file logger at {target_file}: {e}\n")

        # Prevent propagation to the python root logger if already configured
        root_logger.propagate = False
        _INITIALIZED = True
        
        root_logger.debug(
            f"SIRENE Logger initialized at level {log_level_str} | Log file: {LOG_FILE_PATH}"
        )

    return root_logger


def get_logger(name: str) -> logging.Logger:
    """
    Returns a child logger scoped under 'sirene.<name>'.
    Ensures the parent logging infrastructure is initialized.
    """
    if not _INITIALIZED:
        setup_logging()
    
    if name.startswith("sirene."):
        return logging.getLogger(name)
    return logging.getLogger(f"sirene.{name}")


@contextmanager
def log_duration(logger: logging.Logger, operation_name: str, level: int = logging.INFO):
    """
    Context manager to log the duration and outcome of critical operations (DuckDB queries, ETL steps, I/O).
    """
    start_time = time.perf_counter()
    logger.log(level, f"[START] {operation_name}")
    try:
        yield
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.log(level, f"[COMPLETED] {operation_name} in {elapsed_ms:.2f}ms ({elapsed_ms/1000:.3f}s)")
    except Exception as e:
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.error(f"[FAILED] {operation_name} after {elapsed_ms:.2f}ms with error: {type(e).__name__}: {e}", exc_info=True)
        raise
