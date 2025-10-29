"""
음성 인식 모듈
Discord 음성 채널에서 음성을 실시간으로 인식하고 명령어를 파싱합니다.
"""

import os
import asyncio
import logging
from typing import Optional, Callable, Dict
import discord
import speech_recognition as sr
from io import BytesIO
import wave
import time
from collections import deque

log = logging.getLogger(__name__)

# discord.sinks 호환성 처리
try:
    from discord.sinks import Sink as DiscordSink
except (ImportError, AttributeError):
    # discord.sinks가 없으면 기본 클래스 사용
    class DiscordSink:
        """discord.sinks.Sink의 대체 클래스"""
        def __init__(self):
            pass

        def cleanup(self):
            pass


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

        # 음성 인식 설정 - 더 민감하게 조정
        self.recognizer.energy_threshold = 200  # 배경 소음 감지 임계값 (낮출수록 더 민감)
        self.recognizer.dynamic_energy_threshold = True
        self.recognizer.pause_threshold = 0.5  # 말이 끝난 것으로 판단하는 침묵 시간 (짧게)
        self.recognizer.phrase_threshold = 0.2  # 말을 시작했다고 판단하는 시간 (짧게)

        log.info(f"VoiceRecognitionHandler initialized with bot_name: {bot_name}")

    def register_command(self, command: str, callback: Callable):
        """
        음성 명령어와 콜백 함수를 등록합니다.

        Args:
            command: 음성 명령어 (예: "재생", "일시정지")
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
            "재생": "play",
            "플레이": "play",
            "틀어줘": "play",
            "들려줘": "play",
            "일시정지": "pause",
            "멈춰": "pause",
            "정지": "pause",
            "다시재생": "resume",
            "계속": "resume",
            "다시": "resume",
            "스킵": "skip",
            "건너뛰기": "skip",
            "넘겨": "skip",
            "다음": "skip",
            "큐": "queue",
            "대기열": "queue",
            "목록": "queue",
            "지금재생": "np",
            "현재곡": "np",
            "지금곡": "np",
            "볼륨": "volume",
            "음량": "volume",
            "소리": "volume",
            "셔플": "shuffle",
            "섞기": "shuffle",
            "반복": "repeat",
            "리피트": "repeat",
            "나와": "disconnect",
            "종료": "disconnect",
            "끊어": "disconnect",
            "그만": "disconnect",
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
        self.chunk_duration = 1.0  # 1초마다 처리
        self.min_audio_length = 4800  # 최소 오디오 길이 (0.1초)
        self.max_buffer_duration = 5.0  # 최대 버퍼 시간 (5초)

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
            # 비동기로 처리 (블로킹 방지)
            asyncio.create_task(self._process_user_audio_realtime(user))

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
                user = await self.bot.fetch_user(user_id)
                log.info(f"🎯 {user.name} mentioned bot: {text}")

                # 텍스트 채널에 알림
                if text_channel:
                    await text_channel.send(f"🎤 {user.mention} 불렀나요?")

                # 명령어 처리
                parsed = self.recognition_handler.parse_command(text)
                if parsed:
                    command, args = parsed
                    log.info(f"⚡ Executing voice command: {command} {args}")

                    # 명령어를 텍스트 채널에 표시
                    if text_channel:
                        await text_channel.send(f"🔊 명령어: `{command}` {args}")

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


def load_bot_name_from_env() -> str:
    """
    .env 파일에서 봇 이름을 로드합니다.

    Returns:
        봇 이름 (기본값: "뮤직봇")
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
