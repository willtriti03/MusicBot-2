from __future__ import annotations

import asyncio
import json
import logging
import os
import pathlib
from typing import TYPE_CHECKING, Any, Dict, Optional

from .voice_transport import PlaybackAfterCallback

if TYPE_CHECKING:
    from .bot import MusicBot
    from .entry import BasePlaylistEntry


log = logging.getLogger(__name__)


class VoiceSidecarError(RuntimeError):
    """Raised when the embedded voice sidecar cannot satisfy a request."""


class SidecarVoiceClient:
    def __init__(
        self,
        supervisor: "VoiceSidecarSupervisor",
        guild: Any,
        channel: Any,
    ) -> None:
        self.supervisor = supervisor
        self.guild = guild
        self.channel = channel
        self.latency: float = 0.0
        self.average_latency: float = 0.0
        self._connected: bool = False
        self._after: Optional[PlaybackAfterCallback] = None
        self._playback_task: Optional[asyncio.Task[Any]] = None
        self._playback_started: bool = False
        self._last_playback_payload: Dict[str, Any] = {}

    def __repr__(self) -> str:
        return (
            f"<SidecarVoiceClient guild={getattr(self.guild, 'id', None)} "
            f"channel={getattr(self.channel, 'id', None)} connected={self._connected}>"
        )

    def is_connected(self) -> bool:
        return self._connected

    async def disconnect(self, *, force: bool = False) -> None:
        del force
        await self.supervisor.disconnect(self)

    async def move_to(self, channel: Any) -> None:
        await self.supervisor.move_to(self, channel)

    def pause(self) -> None:
        self.supervisor.pause(self)

    def resume(self) -> None:
        self.supervisor.resume(self)

    def stop(self) -> None:
        self.supervisor.stop(self)

    def set_volume(self, value: float) -> None:
        self.supervisor.set_volume(self, value)

    async def play_entry(
        self,
        entry: "BasePlaylistEntry",
        *,
        volume: float,
        after: PlaybackAfterCallback,
    ) -> None:
        self._after = after
        self._playback_started = False
        self._last_playback_payload = self.supervisor.build_playback_payload(entry, volume)
        await self.supervisor.play(self, entry, volume, after)

    def _apply_session_ready(self, payload: Dict[str, Any]) -> None:
        self._connected = True
        latency_ms = float(payload.get("latency_ms", 0.0) or 0.0)
        average_latency_ms = float(payload.get("average_latency_ms", latency_ms) or latency_ms)
        self.latency = latency_ms / 1000.0
        self.average_latency = average_latency_ms / 1000.0

    def _apply_session_closed(self, payload: Dict[str, Any]) -> None:
        del payload
        self._connected = False
        self._playback_started = False

    def _apply_latency(self, payload: Dict[str, Any]) -> None:
        self.latency = float(payload.get("latency_ms", 0.0) or 0.0) / 1000.0
        self.average_latency = (
            float(payload.get("average_latency_ms", payload.get("latency_ms", 0.0)) or 0.0)
            / 1000.0
        )

    def _apply_playback_started(self, payload: Dict[str, Any]) -> None:
        del payload
        self._playback_started = True

    def _apply_playback_finished(self, payload: Dict[str, Any]) -> None:
        del payload
        self._playback_started = False
        self._dispatch_after(None)

    def _apply_playback_error(self, payload: Dict[str, Any]) -> None:
        self._playback_started = False
        message = str(payload.get("message", "Voice sidecar playback failed."))
        self._dispatch_after(VoiceSidecarError(message))

    def _handle_process_exit(self, reason: str) -> None:
        self._connected = False
        if self._playback_started or self._after is not None:
            self._dispatch_after(VoiceSidecarError(reason))

    def _dispatch_after(self, error: Optional[Exception]) -> None:
        callback = self._after
        self._after = None
        if callback is None:
            return

        try:
            callback(error)
        except Exception:
            log.exception("Sidecar playback callback crashed for guild %s", getattr(self.guild, "id", None))


class VoiceSidecarSupervisor:
    def __init__(self, bot: "MusicBot") -> None:
        self.bot = bot
        self.process: Optional[asyncio.subprocess.Process] = None
        self._stdout_task: Optional[asyncio.Task[Any]] = None
        self._stderr_task: Optional[asyncio.Task[Any]] = None
        self._wait_task: Optional[asyncio.Task[Any]] = None
        self._next_request_id: int = 0
        self._pending: Dict[str, asyncio.Future[Any]] = {}
        self._clients: Dict[int, SidecarVoiceClient] = {}
        self._start_lock = asyncio.Lock()
        self._closed: bool = False
        self._ready: bool = False

    @property
    def enabled(self) -> bool:
        return str(getattr(self.bot.config, "voice_transport", "")).strip().lower() == "dave-sidecar"

    def get_client(self, guild_id: int) -> Optional[SidecarVoiceClient]:
        return self._clients.get(guild_id)

    def get_all_clients(self) -> Dict[int, SidecarVoiceClient]:
        return dict(self._clients)

    def get_sidecar_entry(self) -> pathlib.Path:
        root = pathlib.Path(__file__).resolve().parent.parent
        sidecar_root = root / "voice-sidecar"
        candidates = (
            sidecar_root / "dist" / "index.js",
            sidecar_root / "index.js",
        )
        for candidate in candidates:
            if candidate.is_file():
                return candidate
        raise VoiceSidecarError(
            "Voice sidecar entrypoint is missing. Run `npm install && npm run build` in `voice-sidecar/`."
        )

    async def start(self) -> None:
        if not self.enabled or self._closed:
            return

        async with self._start_lock:
            if self.process and self.process.returncode is None:
                return

            entrypoint = self.get_sidecar_entry()
            node_bin = os.environ.get("MUSICBOT_NODE_BIN") or getattr(self.bot.config, "voice_sidecar_node_bin", "") or "node"
            env = os.environ.copy()
            token = ""
            if getattr(self.bot.config, "auth", None):
                token = self.bot.config.auth[0]
            if token:
                env["MUSICBOT_DISCORD_TOKEN"] = token
            env["MUSICBOT_SIDECAR_LOG_LEVEL"] = logging.getLevelName(log.getEffectiveLevel())

            self.process = await asyncio.create_subprocess_exec(
                node_bin,
                str(entrypoint),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(entrypoint.parent if entrypoint.parent.name != "dist" else entrypoint.parent.parent),
                env=env,
            )
            self._ready = True
            self._stdout_task = self.bot.loop.create_task(self._read_stdout(), name="MB_VoiceSidecarStdout")
            self._stderr_task = self.bot.loop.create_task(self._read_stderr(), name="MB_VoiceSidecarStderr")
            self._wait_task = self.bot.loop.create_task(self._wait_for_exit(), name="MB_VoiceSidecarWait")
            await asyncio.sleep(0.25)
            if self.process.returncode is not None:
                raise VoiceSidecarError(
                    "Voice sidecar exited during startup. Ensure `voice-sidecar/` dependencies are installed."
                )
            log.info("Started embedded DAVE voice sidecar pid=%s", self.process.pid)

    async def close(self) -> None:
        self._closed = True
        process = self.process
        if process is None:
            return

        try:
            await self._request("shutdown", {})
        except Exception:
            if process.returncode is None:
                process.terminate()

        if process.returncode is None:
            try:
                await asyncio.wait_for(process.wait(), timeout=5)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()

        self._ready = False
        self.process = None

    async def ensure_started(self) -> None:
        await self.start()
        if not self.process or self.process.returncode is not None:
            raise VoiceSidecarError("Voice sidecar process is not running.")

    async def open_session(
        self,
        guild: Any,
        channel: Any,
        *,
        self_deaf: bool,
        dave_optional: bool,
    ) -> SidecarVoiceClient:
        await self.ensure_started()
        guild_id = int(guild.id)
        client = self._clients.get(guild_id)
        if client is None:
            client = SidecarVoiceClient(self, guild, channel)
            self._clients[guild_id] = client
        else:
            client.guild = guild
            client.channel = channel

        response = await self._request(
            "open_session",
            {
                "guild_id": guild_id,
                "channel_id": int(channel.id),
                "self_deaf": bool(self_deaf),
                "dave_optional": bool(dave_optional),
                "channel_type": type(channel).__name__,
            },
        )
        client._apply_session_ready(response)
        return client

    async def move_to(self, client: SidecarVoiceClient, channel: Any) -> None:
        await self.ensure_started()
        await self._request(
            "move",
            {
                "guild_id": int(client.guild.id),
                "channel_id": int(channel.id),
            },
        )
        client.channel = channel

    async def disconnect(self, client: SidecarVoiceClient) -> None:
        guild_id = int(client.guild.id)
        if self.process and self.process.returncode is None:
            try:
                await self._request("disconnect", {"guild_id": guild_id})
            except Exception:
                log.warning("Voice sidecar disconnect failed for guild %s", guild_id, exc_info=True)

        client._apply_session_closed({})
        self._clients.pop(guild_id, None)

    def pause(self, client: SidecarVoiceClient) -> None:
        self._fire_and_forget("pause", {"guild_id": int(client.guild.id)})

    def resume(self, client: SidecarVoiceClient) -> None:
        self._fire_and_forget("resume", {"guild_id": int(client.guild.id)})

    def stop(self, client: SidecarVoiceClient) -> None:
        self._fire_and_forget("stop", {"guild_id": int(client.guild.id)})

    def set_volume(self, client: SidecarVoiceClient, value: float) -> None:
        self._fire_and_forget(
            "set_volume",
            {"guild_id": int(client.guild.id), "volume": float(value)},
        )

    async def play(
        self,
        client: SidecarVoiceClient,
        entry: "BasePlaylistEntry",
        volume: float,
        after: PlaybackAfterCallback,
    ) -> None:
        del after
        await self.ensure_started()
        payload = self.build_playback_payload(entry, volume)
        payload["guild_id"] = int(client.guild.id)
        await self._request("play", payload)

    def build_playback_payload(
        self,
        entry: "BasePlaylistEntry",
        volume: float,
    ) -> Dict[str, Any]:
        url = str(getattr(entry, "url", "") or "")
        filename = str(getattr(entry, "filename", "") or "")
        source = filename
        source_kind = "path"
        if not source:
            source = url
            source_kind = "url"
        elif not bool(getattr(entry, "is_downloaded", False)) and url:
            source = url
            source_kind = "url"

        return {
            "entry_id": str(id(entry)),
            "title": str(getattr(entry, "title", "") or source),
            "source": source,
            "source_kind": source_kind,
            "url": url,
            "filename": filename,
            "is_downloaded": bool(getattr(entry, "is_downloaded", False)),
            "playback_mode": getattr(getattr(entry, "playback_mode", None), "value", "download"),
            "start_time": float(getattr(entry, "start_time", 0.0) or 0.0),
            "playback_speed": float(getattr(entry, "playback_speed", 1.0) or 1.0),
            "before_options": str(getattr(entry, "boptions", "") or ""),
            "after_options": str(getattr(entry, "aoptions", "") or ""),
            "volume": float(volume),
        }

    async def _request(self, command: str, data: Dict[str, Any]) -> Dict[str, Any]:
        await self.ensure_started()
        if not self.process or not self.process.stdin:
            raise VoiceSidecarError("Voice sidecar stdin is unavailable.")

        self._next_request_id += 1
        request_id = str(self._next_request_id)
        future: asyncio.Future[Any] = self.bot.loop.create_future()
        self._pending[request_id] = future

        payload = {
            "op": "request",
            "id": request_id,
            "command": command,
            "data": data,
        }
        self.process.stdin.write((json.dumps(payload, ensure_ascii=True) + "\n").encode("utf8"))
        await self.process.stdin.drain()

        try:
            response = await asyncio.wait_for(future, timeout=30)
        finally:
            self._pending.pop(request_id, None)

        if not isinstance(response, dict):
            raise VoiceSidecarError(f"Voice sidecar returned an invalid response for `{command}`.")
        return response

    def _fire_and_forget(self, command: str, data: Dict[str, Any]) -> None:
        async def runner() -> None:
            try:
                await self._request(command, data)
            except Exception:
                log.warning("Voice sidecar `%s` request failed", command, exc_info=True)

        if self.bot.loop.is_closed():
            return
        self.bot.loop.create_task(runner(), name=f"MB_VoiceSidecar_{command}")

    async def _read_stdout(self) -> None:
        assert self.process and self.process.stdout
        while True:
            raw_line = await self.process.stdout.readline()
            if not raw_line:
                return

            try:
                message = json.loads(raw_line.decode("utf8"))
            except json.JSONDecodeError:
                log.warning("Voice sidecar emitted malformed stdout: %s", raw_line.decode("utf8", "replace").rstrip())
                continue

            self._handle_message(message)

    async def _read_stderr(self) -> None:
        assert self.process and self.process.stderr
        while True:
            raw_line = await self.process.stderr.readline()
            if not raw_line:
                return
            log.warning("[voice-sidecar] %s", raw_line.decode("utf8", "replace").rstrip())

    async def _wait_for_exit(self) -> None:
        assert self.process
        return_code = await self.process.wait()
        self.process = None
        if self._closed:
            return

        reason = f"Voice sidecar exited unexpectedly with code {return_code}."
        log.error(reason)
        self._ready = False
        for future in list(self._pending.values()):
            if not future.done():
                future.set_exception(VoiceSidecarError(reason))
        self._pending.clear()

        for client in list(self._clients.values()):
            client._handle_process_exit(reason)

        if hasattr(self.bot, "handle_voice_sidecar_exit"):
            self.bot.loop.create_task(
                self.bot.handle_voice_sidecar_exit(reason),
                name="MB_VoiceSidecarCrashHandler",
            )

    def _handle_message(self, message: Dict[str, Any]) -> None:
        op = message.get("op")
        if op == "response":
            request_id = str(message.get("id", ""))
            future = self._pending.get(request_id)
            if future is None or future.done():
                return

            if message.get("ok", False):
                future.set_result(message.get("data", {}))
            else:
                future.set_exception(VoiceSidecarError(str(message.get("error", "Voice sidecar request failed."))))
            return

        if op != "event":
            log.debug("Ignoring unknown sidecar message: %s", message)
            return

        event_name = str(message.get("event", ""))
        data = message.get("data", {})
        if event_name == "log":
            level_name = str(data.get("level", "info")).upper()
            log.log(getattr(logging, level_name, logging.INFO), "[voice-sidecar] %s", data.get("message", ""))
            return

        guild_id = int(data.get("guild_id", 0) or 0)
        client = self._clients.get(guild_id)
        if client is None:
            return

        if event_name == "session_ready":
            client._apply_session_ready(data)
        elif event_name == "session_closed":
            client._apply_session_closed(data)
        elif event_name == "latency_update":
            client._apply_latency(data)
        elif event_name == "playback_started":
            client._apply_playback_started(data)
        elif event_name == "playback_finished":
            client._apply_playback_finished(data)
        elif event_name == "playback_error":
            client._apply_playback_error(data)
