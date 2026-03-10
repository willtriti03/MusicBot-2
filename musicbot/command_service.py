from __future__ import annotations

import inspect
import logging
from typing import TYPE_CHECKING, Any, Dict, List, Optional

import discord

from .constructs import Response
from .exceptions import CommandError
from .models import VoiceIntent
from .playback import PlaybackMode

if TYPE_CHECKING:
    from discord.commands import ApplicationContext

log = logging.getLogger(__name__)


class CommandService:
    def __init__(self, bot: Any, coordinator: Any, media_resolver: Any) -> None:
        self.bot = bot
        self.coordinator = coordinator
        self.media_resolver = media_resolver

    async def execute_slash(
        self,
        command: str,
        ctx: "ApplicationContext",
        **options: Any,
    ) -> Any:
        guild = self.bot._get_slash_guild(ctx)
        author = self.bot._get_slash_author(ctx)
        channel = self.bot._get_slash_channel(ctx)
        permissions = self.bot._get_slash_permissions(ctx)
        return await self._dispatch(
            command,
            guild=guild,
            author=author,
            channel=channel,
            permissions=permissions,
            interaction=ctx.interaction,
            options=options,
        )

    async def execute_voice_intent(
        self,
        intent: VoiceIntent,
        member: discord.Member,
        text_channel: discord.TextChannel,
        guild: discord.Guild,
    ) -> Any:
        response = await self._dispatch(
            intent.command,
            guild=guild,
            author=member,
            channel=text_channel,
            permissions=self.bot.permissions.for_user(member),
            interaction=None,
            options={"args": intent.args},
            source="voice",
        )
        if isinstance(response, Response):
            content: Any = response.content
            if self.bot.config.embeds and not isinstance(content, discord.Embed):
                embed = self.bot._gen_embed()
                embed.title = intent.command
                embed.description = str(content)
                content = embed
            await self.bot.safe_send_message(
                text_channel,
                content,
                expire_in=response.delete_after if self.bot.config.delete_messages else 0,
            )
        return response

    async def _dispatch(
        self,
        command: str,
        *,
        guild: discord.Guild,
        author: discord.Member,
        channel: Any,
        permissions: Any,
        interaction: Any,
        options: Dict[str, Any],
        source: str = "slash",
    ) -> Any:
        command = self._resolve_alias(command)
        args = str(options.get("args", "") or "").strip()

        if command == "play":
            request = self.media_resolver.build_request(
                str(options.get("query", args)),
                playback_mode=PlaybackMode.DOWNLOAD,
                guild_id=guild.id,
                channel_id=channel.id,
                author_id=author.id,
            )
            return await self.coordinator.enqueue_request(
                request,
                channel=channel,
                guild=guild,
                author=author,
                permissions=permissions,
            )

        if command == "stream":
            request = self.media_resolver.build_request(
                str(options.get("query", args)),
                playback_mode=PlaybackMode.STREAM,
                guild_id=guild.id,
                channel_id=channel.id,
                author_id=author.id,
            )
            return await self.coordinator.enqueue_request(
                request,
                channel=channel,
                guild=guild,
                author=author,
                permissions=permissions,
            )

        if command == "summon":
            return await self.coordinator.summon(guild, author)

        if command == "skip":
            player = self.bot.get_player_in(guild)
            if not player:
                raise CommandError("The bot is not in a voice channel.  Use /summon to summon it to your voice channel.", expire_in=30)
            vote_token = interaction if interaction is not None else object()
            return await self.bot.cmd_skip(
                guild,
                player,
                author,
                vote_token,
                permissions,
                self.bot._get_slash_skip_voice_channel(guild) if source == "slash" else getattr(getattr(guild.me, "voice", None), "channel", None),
                "force" if bool(options.get("force", False)) else "",
            )

        if command == "pause":
            return await self.bot.cmd_pause(self._require_player(guild))

        if command == "resume":
            return await self.bot.cmd_resume(self._require_player(guild))

        if command == "queue":
            return await self.bot.cmd_queue(
                guild,
                channel,
                self._require_player(guild),
                str(options.get("page", args or "0")),
            )

        if command == "np":
            return await self.bot.cmd_np(self._require_player(guild), channel, guild)

        if command == "volume":
            return await self.bot.cmd_volume(
                self._require_player(guild),
                str(options.get("level", args)),
            )

        if command == "disconnect":
            return await self.coordinator.disconnect(guild)

        if command == "purgecache":
            if author.id != self.bot.config.owner_id:
                raise CommandError("Only the owner can use this command.", expire_in=30)
            return await self.bot.cmd_purgecache()

        if command == "listen":
            return await self.bot.cmd_listen(guild, channel, author)

        if command == "stoplisten":
            return await self.bot.cmd_stoplisten(guild, channel)

        if command == "autoplaylist":
            option, value = self._split_first_arg(args or str(options.get("option", "")), str(options.get("value", "")))
            if not option:
                option = "show"
            return await self.coordinator.autoplaylist(guild, author, option, value)

        if command == "autosimilar":
            return await self.coordinator.autosimilar(guild, str(options.get("value", args)))

        return await self._execute_legacy_command(
            command,
            args,
            member=author,
            text_channel=channel,
            guild=guild,
        )

    def _resolve_alias(self, command: str) -> str:
        command = command.lower().strip()
        if self.bot.config.usealias and hasattr(self.bot, "aliases"):
            alias_command = self.bot.aliases.get(command)
            if alias_command:
                return alias_command
        return command

    def _require_player(self, guild: discord.Guild) -> Any:
        player = self.bot.get_player_in(guild)
        if player:
            return player
        raise CommandError(
            "The bot is not in a voice channel.  Use /summon to summon it to your voice channel.",
            expire_in=30,
        )

    def _split_first_arg(self, first: str, second: str) -> Any:
        if second:
            return str(first).strip(), str(second).strip()
        parts = str(first).split(maxsplit=1)
        if not parts:
            return "", ""
        if len(parts) == 1:
            return parts[0], ""
        return parts[0], parts[1]

    async def _execute_legacy_command(
        self,
        command: str,
        args: str,
        *,
        member: discord.Member,
        text_channel: Any,
        guild: discord.Guild,
    ) -> Any:
        handler = getattr(self.bot, "cmd_" + command, None)
        if not handler:
            log.warning("Command handler not found: %s", command)
            return None

        args_list = args.split() if args else []
        argspec = inspect.signature(handler)
        params = argspec.parameters.copy()
        handler_kwargs: Dict[str, Any] = {}

        if params.pop("message", None):
            class MinimalMessage:
                def __init__(self, content: str, channel: Any, author: discord.Member, guild: discord.Guild):
                    self.content = content
                    self.channel = channel
                    self.author = author
                    self.guild = guild
                    self.mentions: List[Any] = []
                    self.mention_everyone = False
                    self.id = 0
                    self.attachments: List[Any] = []
                    self.raw_mentions: List[int] = []
                    self.raw_channel_mentions: List[int] = []

            full_content = f"/{command}"
            if args:
                full_content += f" {args}"
            handler_kwargs["message"] = MinimalMessage(full_content, text_channel, member, guild)

        if params.pop("channel", None):
            class TypingWrapper:
                def __init__(self, channel: Any) -> None:
                    self._channel = channel

                def __getattr__(self, name: str) -> Any:
                    if name == "typing":
                        return self._typing_wrapper
                    return getattr(self._channel, name)

                def _typing_wrapper(self) -> Any:
                    channel_ref = self._channel

                    class TypingProxy:
                        def __await__(self):
                            return channel_ref.trigger_typing().__await__()

                    return TypingProxy()

            handler_kwargs["channel"] = TypingWrapper(text_channel)

        if params.pop("author", None):
            handler_kwargs["author"] = member

        if params.pop("guild", None):
            handler_kwargs["guild"] = guild

        if params.pop("player", None):
            if member.voice and member.voice.channel:
                auto_connect_commands = {"play", "shuffleplay", "playnext", "playnow", "stream"}
                handler_kwargs["player"] = await self.bot.get_player(
                    member.voice.channel,
                    create=command in auto_connect_commands,
                    deserialize=(
                        command in auto_connect_commands and self.bot.config.persistent_queue
                    ),
                )
            else:
                raise CommandError("이 명령어는 음성 채널에 있어야 합니다.")

        if params.pop("_player", None):
            handler_kwargs["_player"] = self.bot.get_player_in(guild)

        if params.pop("permissions", None):
            handler_kwargs["permissions"] = self.bot.permissions.for_user(member)

        if params.pop("user_mentions", None):
            handler_kwargs["user_mentions"] = []

        if params.pop("channel_mentions", None):
            handler_kwargs["channel_mentions"] = []

        if params.pop("voice_channel", None):
            handler_kwargs["voice_channel"] = (
                guild.me.voice.channel if guild.me and guild.me.voice else None
            )

        if params.pop("leftover_args", None):
            handler_kwargs["leftover_args"] = args_list

        for key, param in list(params.items()):
            if param.kind == param.VAR_POSITIONAL:
                handler_kwargs[key] = args_list
                params.pop(key)
                continue

            if param.kind == param.KEYWORD_ONLY and param.default == param.empty:
                handler_kwargs[key] = args if args_list else ""
                params.pop(key)
                continue

            if not args_list and param.default is not param.empty:
                params.pop(key)
                continue

            if args_list:
                handler_kwargs[key] = args_list.pop(0)
                params.pop(key)

        if params:
            log.warning(
                "Missing required parameters for command %s: %s",
                command,
                list(params.keys()),
            )

        return await handler(**handler_kwargs)
