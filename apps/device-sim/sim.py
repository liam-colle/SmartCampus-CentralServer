#!/usr/bin/env python3
"""SmartCampus device simulator and protocol test tool. See README.md."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from scsim.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
