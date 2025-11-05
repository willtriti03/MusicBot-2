"""
음성 인식 모듈
Discord 음성 채널에서 음성을 실시간으로 인식하고 명령어를 파싱합니다.
"""

import os
import asyncio
import logging
import inspect
from typing import Optional, Callable, Dict, List, Any
import discord
import speech_recognition as sr
from io import BytesIO
import wave
import time
from collections import deque
import aiohttp

log = logging.getLogger(__name__)

# discord.sinks import (py-cord 2.4.0+ 필요)
from discord.sinks import Sink as DiscordSink

# .env 파일에서 환경 변수 로드
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# 웹훅 URL 로드
WEBHOOK_URL = os.getenv("TEXT_WEBHOOK", "")


class VoiceRecognitionHandler:
    """
    Discord 음성 채널에서 음성을 인식하고 처리하는 핸들러
    """

    def __init__(self, bot_name: str):
        """
        Args:
            bot_name: 봇 이름 (음성으로 부를 이름)
        """
        self.bot_name = bot_name.lower()
        self.recognizer = sr.Recognizer()
        self.is_listening = False
        self.command_callbacks: Dict[str, Callable] = {}

        # 음성 인식 설정 - 문장 단위로 인식하도록 조정
        self.recognizer.energy_threshold = 300  # 배경 소음 감지 임계값
        self.recognizer.dynamic_energy_threshold = True
        self.recognizer.pause_threshold = 0.9  # 말이 끝난 것으로 판단하는 침묵 시간 (0.9초)
        self.recognizer.phrase_threshold = 0.3  # 말을 시작했다고 판단하는 시간
        self.recognizer.non_speaking_duration = 0.8  # 침묵으로 판단하는 시간

        log.info(f"VoiceRecognitionHandler initialized with bot_name: {bot_name}")

    def register_command(self, command: str, callback: Callable):
        """
        음성 명령어와 콜백 함수를 등록합니다.

        Args:
            command: 음성 명령어 (예: "!재생", "일시정지")
            callback: 명령어가 인식되었을 때 실행할 함수
        """
        self.command_callbacks[command.lower()] = callback
        log.info(f"Registered voice command: {command}")

    async def process_audio_chunk(self, audio_data: bytes, sample_rate: int = 48000) -> Optional[str]:
        """
        오디오 청크를 처리하고 음성을 텍스트로 변환합니다.

        Args:
            audio_data: PCM 오디오 데이터
            sample_rate: 샘플링 레이트

        Returns:
            인식된 텍스트 또는 None
        """
        try:
            # PCM 데이터를 WAV 형식으로 변환
            audio_io = BytesIO()
            with wave.open(audio_io, 'wb') as wav_file:
                wav_file.setnchannels(2)  # Discord는 스테레오
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(audio_data)

            audio_io.seek(0)

            # speech_recognition의 AudioData 형식으로 변환
            with sr.AudioFile(audio_io) as source:
                # 배경 소음 조정
                self.recognizer.adjust_for_ambient_noise(source, duration=0.2)
                audio = self.recognizer.record(source)

            # Google Speech Recognition API를 사용하여 음성 인식
            # 한국어로 인식 시도
            text = await asyncio.to_thread(
                self.recognizer.recognize_google,
                audio,
                language="ko-KR"
            )

            log.info(f"✅ Recognized speech: {text}")

            # 웹훅으로 전송
            if WEBHOOK_URL:
                asyncio.create_task(self._send_to_webhook(text))

            return text.lower()

        except sr.UnknownValueError:
            # 음성을 이해하지 못함 - 너무 많이 로깅하지 않음
            return None
        except sr.RequestError as e:
            log.error(f"❌ Could not request results from speech recognition service; {e}")
            return None
        except Exception as e:
            log.debug(f"Error processing audio chunk: {e}")
            return None

    async def _send_to_webhook(self, text: str):
        """
        인식된 텍스트를 웹훅으로 전송합니다.

        Args:
            text: 인식된 텍스트
        """
        try:
            async with aiohttp.ClientSession() as session:
                data = {
                    "content": f"🎤 **음성 인식**: {text}",
                    "username": "!음성 인식 로그"
                }
                async with session.post(WEBHOOK_URL, json=data) as resp:
                    if resp.status == 204:
                        log.debug(f"Webhook sent successfully: {text}")
                    else:
                        log.warning(f"Webhook failed with status {resp.status}")
        except Exception as e:
            log.debug(f"Error sending webhook: {e}")

    def parse_command(self, text: str) -> Optional[tuple]:
        """
        인식된 텍스트에서 봇 이름과 명령어를 파싱합니다.

        Args:
            text: 인식된 텍스트

        Returns:
            (명령어, 인자) 튜플 또는 None
        """
        if not text:
            return None

        text = text.lower().strip()

        # 봇 이름이 포함되어 있는지 확인
        if self.bot_name not in text:
            return None

        # 봇 이름 이후의 텍스트 추출
        bot_name_index = text.find(self.bot_name)
        command_text = text[bot_name_index + len(self.bot_name):].strip()

        if not command_text:
            return None

        # 명령어 매핑
        command_map = {
            "재생": "!play",
            "플레이": "!play",
            "틀어줘": "!play",
            "들려줘": "!play",
            "일시정지": "!pause",
            "멈춰": "!pause",
            "정지": "!pause",
            "다시재생": "!resume",
            "계속": "!resume",
            "다시": "!resume",
            "스킵": "!skip",
            "건너뛰기": "!skip",
            "넘겨": "!skip",
            "다음": "!skip",
            "큐": "!queue",
            "대기열": "!queue",
            "목록": "!queue",
            "지금재생": "!np",
            "현재곡": "!np",
            "지금곡": "!np",
            "볼륨": "!volume",
            "음량": "!volume",
            "소리": "!volume",
            "셔플": "!shuffle",
            "섞기": "!shuffle",
            "반복": "!repeat",
            "리피트": "!repeat",
            "나와": "!disconnect",
            "종료": "!disconnect",
            "끊어": "!disconnect",
            "그만": "!disconnect",
        }

        # 명령어 찾기 (가장 긴 매칭 우선)
        for korean_cmd, english_cmd in sorted(command_map.items(), key=lambda x: len(x[0]), reverse=True):
            if command_text.startswith(korean_cmd):
                # 명령어 이후의 텍스트를 인자로 사용
                args = command_text[len(korean_cmd):].strip()
                return (english_cmd, args)

        # 매칭되는 명령어가 없으면 None 반환
        return None

    async def handle_voice_command(self, text: str) -> bool:
        """
        음성 명령어를 처리합니다.

        Args:
            text: 인식된 텍스트

        Returns:
            명령어가 처리되었는지 여부
        """
        parsed = self.parse_command(text)
        if not parsed:
            return False

        command, args = parsed

        # 등록된 콜백 실행
        if command in self.command_callbacks:
            try:
                await self.command_callbacks[command](args)
                log.info(f"Executed voice command: {command} with args: {args}")
                return True
            except Exception as e:
                log.error(f"Error executing voice command {command}: {e}", exc_info=True)
                return False

        return False

    def update_settings(self, **kwargs):
        """
        음성 인식 설정을 업데이트합니다.

        Args:
            energy_threshold: 배경 소음 감지 임계값
            pause_threshold: 말이 끝난 것으로 판단하는 침묵 시간
            phrase_threshold: 말을 시작했다고 판단하는 시간
            non_speaking_duration: 침묵으로 판단하는 시간
        """
        if 'energy_threshold' in kwargs:
            self.recognizer.energy_threshold = kwargs['energy_threshold']
            log.info(f"Updated energy_threshold to {kwargs['energy_threshold']}")

        if 'pause_threshold' in kwargs:
            self.recognizer.pause_threshold = kwargs['pause_threshold']
            log.info(f"Updated pause_threshold to {kwargs['pause_threshold']}")

        if 'phrase_threshold' in kwargs:
            self.recognizer.phrase_threshold = kwargs['phrase_threshold']
            log.info(f"Updated phrase_threshold to {kwargs['phrase_threshold']}")

        if 'non_speaking_duration' in kwargs:
            self.recognizer.non_speaking_duration = kwargs['non_speaking_duration']
            log.info(f"Updated non_speaking_duration to {kwargs['non_speaking_duration']}")

    def get_settings(self) -> dict:
        """
        현재 음성 인식 설정을 반환합니다.

        Returns:
            설정 딕셔너리
        """
        return {
            "energy_threshold": self.recognizer.energy_threshold,
            "pause_threshold": self.recognizer.pause_threshold,
            "phrase_threshold": self.recognizer.phrase_threshold,
            "non_speaking_duration": getattr(self.recognizer, 'non_speaking_duration', 0.8),
            "dynamic_energy_threshold": self.recognizer.dynamic_energy_threshold
        }


class RealtimeAudioSink(DiscordSink):
    """
    Discord 음성 채널에서 오디오를 실시간으로 수신하는 Sink
    """

    def __init__(self, recognition_handler: VoiceRecognitionHandler, callback):
        super().__init__()
        self.recognition_handler = recognition_handler
        self.callback = callback
        self.audio_buffers = {}  # 사용자별 오디오 버퍼
        self.processing_locks = {}  # 사용자별 처리 잠금
        self.last_process_time = {}  # 마지막 처리 시간
        self.sample_rate = 48000
        self.recording = True

        # 실시간 처리 설정
        self.chunk_duration = 5.0  # 5초마다 처리 (문장 단위 인식)
        self.min_audio_length = 24000  # 최소 오디오 길이 (0.5초)
        self.max_buffer_duration = 8.0  # 최대 버퍼 시간 (8초)

        # Event loop 저장 (스레드 안전성을 위해)
        try:
            self.loop = asyncio.get_event_loop()
        except RuntimeError:
            self.loop = None

    def write(self, data, user):
        """
        사용자별 음성 데이터를 실시간으로 수신

        Args:
            data: 오디오 데이터
            user: 사용자 ID
        """
        # 봇 자신의 음성은 무시
        if hasattr(self, 'bot_id') and user == self.bot_id:
            return

        # 사용자별 버퍼 초기화
        if user not in self.audio_buffers:
            self.audio_buffers[user] = deque(maxlen=int(self.sample_rate * self.max_buffer_duration))
            self.processing_locks[user] = asyncio.Lock()
            self.last_process_time[user] = time.time()

        # 버퍼에 데이터 추가
        self.audio_buffers[user].append(data)

        # 일정 시간이 지났으면 처리 트리거
        current_time = time.time()
        if current_time - self.last_process_time[user] >= self.chunk_duration:
            # 비동기로 처리 (블로킹 방지, 스레드 안전)
            if self.loop and not self.loop.is_closed():
                asyncio.run_coroutine_threadsafe(
                    self._process_user_audio_realtime(user),
                    self.loop
                )

    async def _process_user_audio_realtime(self, user_id):
        """
        사용자의 오디오를 실시간으로 처리

        Args:
            user_id: 사용자 ID
        """
        # 중복 처리 방지
        if user_id not in self.processing_locks:
            return

        # 이미 처리 중이면 스킵
        if self.processing_locks[user_id].locked():
            return

        async with self.processing_locks[user_id]:
            try:
                # 버퍼에서 오디오 데이터 가져오기
                if user_id not in self.audio_buffers or not self.audio_buffers[user_id]:
                    return

                # 오디오 데이터를 바이트로 결합
                audio_bytes = b''.join(self.audio_buffers[user_id])

                # 너무 짧은 오디오는 무시
                if len(audio_bytes) < self.min_audio_length:
                    return

                log.debug(f"🎤 Processing audio for user {user_id}, size: {len(audio_bytes)} bytes")

                # 음성 인식 처리
                text = await self.recognition_handler.process_audio_chunk(
                    audio_bytes,
                    self.sample_rate
                )

                # 처리 완료, 마지막 처리 시간 업데이트
                self.last_process_time[user_id] = time.time()

                # 버퍼 클리어 (처리된 데이터는 제거)
                self.audio_buffers[user_id].clear()

                # 텍스트가 인식되었으면 처리
                if text:
                    log.info(f"👤 User {user_id} said: {text}")

                    # 봇 이름이 언급되었는지 확인
                    if self.recognition_handler.bot_name in text.lower():
                        log.info(f"🔔 Bot name detected in: {text}")
                        if self.callback:
                            await self.callback(user_id, text)

            except Exception as e:
                log.error(f"❌ Error in realtime audio processing: {e}", exc_info=True)

    def cleanup(self):
        """리소스 정리"""
        self.audio_buffers.clear()
        self.processing_locks.clear()
        self.last_process_time.clear()
        self.recording = False


class VoiceListener:
    """
    Discord 음성 채널 실시간 리스너 관리 클래스
    """

    def __init__(self, bot, recognition_handler: VoiceRecognitionHandler):
        """
        Args:
            bot: MusicBot 인스턴스
            recognition_handler: VoiceRecognitionHandler 인스턴스
        """
        self.bot = bot
        self.recognition_handler = recognition_handler
        self.active_sinks = {}

    async def start_listening(self, voice_client: discord.VoiceClient, text_channel):
        """
        음성 채널에서 실시간 듣기 시작

        Args:
            voice_client: Discord VoiceClient
            text_channel: 응답을 보낼 텍스트 채널
        """
        if not voice_client or not voice_client.is_connected():
            log.error("Voice client is not connected")
            return

        guild_id = voice_client.guild.id

        # 이미 듣고 있는 경우
        if guild_id in self.active_sinks:
            log.warning(f"Already listening in guild {guild_id}")
            return

        # 콜백 함수 생성
        async def on_voice_detected(user_id, text):
            """음성이 감지되었을 때 호출되는 콜백"""
            try:
                # Member 객체 가져오기 (voice 속성 필요)
                guild = voice_client.guild
                member = await guild.fetch_member(user_id)
                log.info(f"🎯 {member.name} mentioned bot: {text}")

                # 텍스트 채널에 알림
                if text_channel:
                    await text_channel.send(f"🎤 {member.mention} 불렀나요?")

                # 명령어 처리
                parsed = self.recognition_handler.parse_command(text)
                if parsed:
                    command, args = parsed
                    log.info(f"⚡ Executing voice command: {command} {args}")

                    # 명령어를 텍스트 채널에 표시
                    if text_channel:
                        await text_channel.send(f"🔊 명령어: `{command}` {args}")

                    # 실제 명령어 실행 - 직접 명령어 핸들러 호출
                    try:
                        await self._execute_command_directly(
                            command=command,
                            args=args,
                            member=member,
                            text_channel=text_channel,
                            guild=text_channel.guild
                        )
                        log.info(f"✅ Voice command executed successfully: {command}")

                    except Exception as cmd_error:
                        log.error(f"❌ Error executing voice command: {cmd_error}", exc_info=True)
                        if text_channel:
                            await text_channel.send(f"❌ 명령어 실행 실패: {str(cmd_error)}")

            except Exception as e:
                log.error(f"❌ Error in voice detection callback: {e}", exc_info=True)

        # RealtimeAudioSink 생성
        sink = RealtimeAudioSink(self.recognition_handler, on_voice_detected)
        sink.bot_id = self.bot.user.id if self.bot.user else None
        self.active_sinks[guild_id] = sink

        # 녹음 시작
        voice_client.start_recording(
            sink,
            self._create_finished_callback(guild_id, text_channel),
            text_channel
        )

        log.info(f"🎧 Started realtime voice listening in guild {guild_id}")

    def _create_finished_callback(self, guild_id: int, text_channel):
        """녹음 종료 콜백 생성"""
        async def finished_callback(sink, exc):
            if exc:
                log.error(f"❌ Recording finished with error: {exc}")
            else:
                log.info(f"✅ Recording finished for guild {guild_id}")

            # 정리
            if sink:
                sink.cleanup()

            if guild_id in self.active_sinks:
                del self.active_sinks[guild_id]

        return finished_callback

    async def stop_listening(self, voice_client: discord.VoiceClient):
        """
        음성 채널에서 듣기 중지

        Args:
            voice_client: Discord VoiceClient
        """
        if not voice_client:
            return

        guild_id = voice_client.guild.id

        # 녹음 중지
        if voice_client.is_connected():
            voice_client.stop_recording()

        # Sink 정리
        if guild_id in self.active_sinks:
            self.active_sinks[guild_id].cleanup()
            del self.active_sinks[guild_id]

        log.info(f"🔇 Stopped listening in guild {guild_id}")

    def is_listening(self, guild_id: int) -> bool:
        """
        특정 길드에서 듣고 있는지 확인

        Args:
            guild_id: 길드 ID

        Returns:
            듣고 있으면 True, 아니면 False
        """
        return guild_id in self.active_sinks

    async def _execute_command_directly(
        self,
        command: str,
        args: str,
        member: discord.Member,
        text_channel: discord.TextChannel,
        guild: discord.Guild
    ):
        """
        명령어 핸들러를 직접 호출합니다.
        가짜 메시지를 생성하지 않고 봇의 명령어 처리 로직을 재사용합니다.

        Args:
            command: 명령어 이름 (예: "play", "skip")
            args: 명령어 인자 문자열
            member: 명령어를 실행한 멤버
            text_channel: 텍스트 채널
            guild: 길드
        """
        # 명령어 이름에서 "!" 제거 (이미 제거되어 있을 수 있음)
        command = command.lstrip("!")
        
        # 핸들러 찾기
        handler = getattr(self.bot, "cmd_" + command, None)
        if not handler:
            # alias 확인
            if hasattr(self.bot, 'config') and self.bot.config.usealias and hasattr(self.bot, 'aliases'):
                alias_command = self.bot.aliases.get(command)
                if alias_command:
                    command = alias_command
                    handler = getattr(self.bot, "cmd_" + command, None)
            
            if not handler:
                log.warning(f"Command handler not found: {command}")
                return

        # 인자를 리스트로 변환
        args_list = args.split() if args else []

        # 핸들러 시그니처 가져오기
        argspec = inspect.signature(handler)
        params = argspec.parameters.copy()

        # handler_kwargs 구성 (bot.py의 로직 재사용)
        handler_kwargs: Dict[str, Any] = {}

        # message 파라미터가 필요한 경우 최소한의 FakeMessage 생성
        if params.pop("message", None):
            # 최소한의 메시지 객체만 생성 (필요한 경우에만)
            class MinimalMessage:
                def __init__(self, content, channel, author, guild):
                    self.content = content
                    self.channel = channel
                    self.author = author
                    self.guild = guild
                    self.mentions = []
                    self.mention_everyone = False
                    self.id = 0
                    self.attachments = []
                    self.raw_mentions = []
                    self.raw_channel_mentions = []

            command_prefix = self.bot.config.command_prefix if hasattr(self.bot, 'config') else "!"
            full_content = f"{command_prefix}{command}"
            if args:
                full_content += f" {args}"
            
            handler_kwargs["message"] = MinimalMessage(
                content=full_content,
                channel=text_channel,
                author=member,
                guild=guild
            )

        # 다른 파라미터들 처리
        if params.pop("channel", None):
            # channel을 래핑하여 await channel.typing() 호출을 처리
            class TypingWrapper:
                """channel.typing() 호출을 올바르게 처리하는 래퍼"""
                def __init__(self, channel):
                    self._channel = channel
                
                def __getattr__(self, name):
                    # typing() 메서드만 래핑, 나머지는 원본 사용
                    if name == "typing":
                        return self._typing_wrapper
                    return getattr(self._channel, name)
                
                def _typing_wrapper(self):
                    """await channel.typing()를 trigger_typing()으로 변환"""
                    # 클로저를 사용하여 _channel에 접근
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

        # player 파라미터 처리
        if params.pop("player", None):
            if member.voice and member.voice.channel:
                try:
                    handler_kwargs["player"] = await self.bot.get_player(member.voice.channel)
                except Exception as e:
                    # 봇이 음성 채널에 없으면 자동으로 summon 시도
                    if "not in a voice channel" in str(e):
                        try:
                            # 임시로 message 객체 생성 (summon에 필요)
                            # 실제로는 message가 없어도 summon이 작동하도록 수정 필요할 수 있음
                            # 하지만 일단 시도해봄
                            from musicbot.constructs import Response
                            # cmd_summon을 직접 호출 (message 없이도 작동하도록)
                            try:
                                # message가 없어도 summon이 작동하도록 수정 필요
                                # 일단 임시로 None을 전달하고, summon 함수가 처리하도록 함
                                await self.bot.cmd_summon(guild, member, None)
                                # summon 후 다시 시도
                                handler_kwargs["player"] = await self.bot.get_player(member.voice.channel)
                            except Exception as summon_error:
                                # summon 실패 시 원래 에러를 다시 발생
                                raise e
                        except Exception:
                            raise e
                    else:
                        raise
            else:
                raise Exception("이 명령어는 음성 채널에 있어야 합니다.")

        # optional player 파라미터
        if params.pop("_player", None):
            handler_kwargs["_player"] = self.bot.get_player_in(guild)

        # permissions 파라미터
        if params.pop("permissions", None):
            if hasattr(self.bot, 'permissions'):
                handler_kwargs["permissions"] = self.bot.permissions.for_user(member)

        # user_mentions 파라미터
        if params.pop("user_mentions", None):
            handler_kwargs["user_mentions"] = []

        # channel_mentions 파라미터
        if params.pop("channel_mentions", None):
            handler_kwargs["channel_mentions"] = []

        # voice_channel 파라미터
        if params.pop("voice_channel", None):
            handler_kwargs["voice_channel"] = (
                guild.me.voice.channel if guild.me.voice else None
            )

        # leftover_args 파라미터
        if params.pop("leftover_args", None):
            handler_kwargs["leftover_args"] = args_list

        # 나머지 파라미터들 처리 (위치 인자 또는 키워드 인자)
        for key, param in list(params.items()):
            # VAR_POSITIONAL (*args)
            if param.kind == param.VAR_POSITIONAL:
                handler_kwargs[key] = args_list
                params.pop(key)
                continue

            # KEYWORD_ONLY (*, args)
            if param.kind == param.KEYWORD_ONLY and param.default == param.empty:
                handler_kwargs[key] = args if args_list else ""
                params.pop(key)
                continue

            # 기본값이 있는 경우 인자가 없으면 스킵
            if not args_list and param.default is not param.empty:
                params.pop(key)
                continue

            # 위치 인자 할당
            if args_list:
                arg_value = args_list.pop(0)
                handler_kwargs[key] = arg_value
                params.pop(key)

        # 필수 파라미터가 남아있으면 에러 (선택적으로 docstring 반환 가능)
        if params:
            log.warning(f"Missing required parameters for command {command}: {list(params.keys())}")
            # 사용법 메시지 반환은 선택적

        # 권한 체크 제거 - 모든 유저가 모든 명령어 사용 가능
        # if hasattr(self.bot, 'config') and hasattr(self.bot, 'permissions'):
        #     user_permissions = self.bot.permissions.for_user(member)
        #     if member.id != self.bot.config.owner_id and command not in ['summon', 'skip', 'remove']:
        #         try:
        #             user_permissions.can_use_command(command)
        #         except Exception as perm_error:
        #             log.warning(f"Permission denied for {member.name}: {perm_error}")
        #             raise

        # 명령어 핸들러 직접 호출
        response = await handler(**handler_kwargs)
        
        # 응답 처리 (필요한 경우)
        if response and hasattr(response, 'content'):
            if hasattr(self.bot, 'safe_send_message'):
                # Response 객체인 경우
                from .constructs import Response
                if isinstance(response, Response):
                    content = response.content
                    if hasattr(self.bot, 'config') and self.bot.config.embeds and not isinstance(content, discord.Embed):
                        embed = self.bot._gen_embed()
                        embed.title = command
                        embed.description = content
                        if response.reply:
                            embed.description = f"{member.mention} {embed.description}"
                        content = embed
                    
                    await self.bot.safe_send_message(
                        text_channel,
                        content,
                        expire_in=response.delete_after if hasattr(self.bot, 'config') and self.bot.config.delete_messages else 0
                    )


def load_bot_name_from_env() -> str:
    """
    .env 파일에서 봇 이름을 로드합니다.

    Returns:
        봇 이름 (기본값: "!뮤직봇")
    """
    try:
        from dotenv import load_dotenv
        # .env 파일 로드
        load_dotenv()
    except ImportError:
        log.warning("python-dotenv is not installed. Using environment variables only.")

    # BOT_NAME 환경 변수 가져오기
    bot_name = os.getenv("BOT_NAME", "뮤직봇")

    return bot_name
