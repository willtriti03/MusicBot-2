from __future__ import annotations

import inspect
import platform
import re
import sys
from importlib import metadata
from typing import Any, Dict, Optional, Tuple


LOCKED_RUNTIME: Dict[str, str] = {
    "python": "3.10",
    "py-cord": "2.7.1",
    "PyNaCl": "1.6.2",
    "yt-dlp": "2026.3.3",
    "certifi": "2026.2.25",
    "SpeechRecognition": "3.14.6",
    "python-dotenv": "1.2.2",
}
REQUIRED_VOICE_MODE = "aead_xchacha20_poly1305_rtpsize"
SUPPORTED_PYTHON_MAX_EXCLUSIVE: Tuple[int, ...] = (3, 14)
DAVE_ENFORCEMENT_DATE = "2026-03-01"


def get_installed_version(package_name: str) -> Optional[str]:
    try:
        return metadata.version(package_name)
    except metadata.PackageNotFoundError:
        return None


def parse_version_tuple(version: str) -> Tuple[int, ...]:
    parts = tuple(int(part) for part in re.findall(r"\d+", version))
    return parts or (0,)


def is_version_at_least(installed_version: str, minimum_version: str) -> bool:
    return parse_version_tuple(installed_version) >= parse_version_tuple(minimum_version)


def get_min_python_version() -> Tuple[int, ...]:
    return parse_version_tuple(LOCKED_RUNTIME["python"])


def get_max_python_version_exclusive() -> Tuple[int, ...]:
    return SUPPORTED_PYTHON_MAX_EXCLUSIVE


def is_python_version_supported(version_info: Tuple[int, ...]) -> bool:
    min_version = get_min_python_version()
    max_version = get_max_python_version_exclusive()
    return min_version <= version_info < max_version


def format_supported_python_range() -> str:
    min_version = get_min_python_version()
    max_version = get_max_python_version_exclusive()
    max_supported_minor = max_version[1] - 1
    return f"{min_version[0]}.{min_version[1]}-{max_version[0]}.{max_supported_minor}"


def has_required_voice_mode(discord_module: Any) -> bool:
    voice_client_module = getattr(discord_module, "voice_client", None)
    voice_client_cls = getattr(voice_client_module, "VoiceClient", None)
    if voice_client_cls is None:
        return False

    supported_modes = getattr(voice_client_cls, "supported_modes", ())
    if REQUIRED_VOICE_MODE in supported_modes:
        return True

    return hasattr(voice_client_cls, "_encrypt_aead_xchacha20_poly1305_rtpsize")


def _callable_accepts_parameter(callable_obj: Any, parameter_name: str) -> bool:
    if callable_obj is None:
        return False

    try:
        signature = inspect.signature(callable_obj)
    except (TypeError, ValueError):
        return False

    return parameter_name in signature.parameters


def has_detectable_dave_support(discord_module: Any) -> bool:
    abc_module = getattr(discord_module, "abc", None)
    connectable_cls = getattr(abc_module, "Connectable", None)
    voice_client_module = getattr(discord_module, "voice_client", None)
    voice_client_cls = getattr(voice_client_module, "VoiceClient", None)
    gateway_module = getattr(discord_module, "gateway", None)
    voice_ws_cls = getattr(gateway_module, "DiscordVoiceWebSocket", None)

    for candidate in (
        getattr(connectable_cls, "connect", None),
        getattr(voice_client_cls, "connect", None),
        getattr(voice_ws_cls, "identify", None),
    ):
        if _callable_accepts_parameter(candidate, "max_dave_protocol_version"):
            return True

    for candidate in (
        discord_module,
        abc_module,
        voice_client_cls,
        voice_ws_cls,
        gateway_module,
    ):
        if candidate and any("dave" in attr.lower() for attr in dir(candidate)):
            return True

    return False


def get_voice_runtime_issue(
    discord_module: Any,
    *,
    requires_dave: bool,
) -> Optional[str]:
    if not has_required_voice_mode(discord_module):
        return (
            "The installed discord voice runtime does not expose "
            f"`{REQUIRED_VOICE_MODE}`, so encrypted voice sessions cannot start."
        )

    if requires_dave and not has_detectable_dave_support(discord_module):
        installed_version = getattr(discord_module, "__version__", "unknown")
        return (
            "Discord enforced DAVE for non-stage voice channels on "
            f"{DAVE_ENFORCEMENT_DATE}, but the installed discord wrapper "
            f"({installed_version}) does not expose detectable DAVE negotiation hooks. "
            "This build cannot join regular voice channels until it is migrated to a "
            "DAVE-capable voice transport."
        )

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
        (
            f"Python: supported {format_supported_python_range()} / "
            f"current {diagnostics['python']}"
        ),
        f"Python executable: {diagnostics['python_executable']}",
    ]
    for package_name, locked_version in LOCKED_RUNTIME.items():
        if package_name == "python":
            continue
        lines.append(
            f"{package_name}: locked {locked_version} / current {diagnostics.get(package_name, 'missing')}"
        )
    return "\n".join(lines)
