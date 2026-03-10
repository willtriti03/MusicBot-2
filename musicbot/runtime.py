from __future__ import annotations

import platform
import sys
from importlib import metadata
from typing import Dict, Optional


LOCKED_RUNTIME: Dict[str, str] = {
    "python": "3.10",
    "py-cord": "2.7.1",
    "PyNaCl": "1.6.2",
    "yt-dlp": "2026.3.3",
    "certifi": "2026.2.25",
    "SpeechRecognition": "3.14.6",
    "python-dotenv": "1.2.2",
}


def get_installed_version(package_name: str) -> Optional[str]:
    try:
        return metadata.version(package_name)
    except metadata.PackageNotFoundError:
        return None


def collect_runtime_diagnostics() -> Dict[str, str]:
    diagnostics = {
        "python": platform.python_version(),
        "python_executable": sys.executable,
    }
    for package_name in LOCKED_RUNTIME:
        if package_name == "python":
            continue
        diagnostics[package_name] = get_installed_version(package_name) or "missing"
    return diagnostics


def format_runtime_diagnostics() -> str:
    diagnostics = collect_runtime_diagnostics()
    lines = [
        f"Python: locked {LOCKED_RUNTIME['python']} / current {diagnostics['python']}",
        f"Python executable: {diagnostics['python_executable']}",
    ]
    for package_name, locked_version in LOCKED_RUNTIME.items():
        if package_name == "python":
            continue
        lines.append(
            f"{package_name}: locked {locked_version} / current {diagnostics.get(package_name, 'missing')}"
        )
    return "\n".join(lines)
