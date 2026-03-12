let Davey = null;

try {
  Davey = require("@snazzah/davey");
} catch (error) {
  Davey = null;
}

function getDaveProtocolVersion() {
  return Davey && Number.isFinite(Davey.DAVE_PROTOCOL_VERSION)
    ? Number(Davey.DAVE_PROTOCOL_VERSION)
    : 0;
}

function buildVoiceJoinConfig(channel) {
  const protocolVersion = getDaveProtocolVersion();
  return {
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
    max_dave_protocol_version: protocolVersion,
    maxDAVEProtocolVersion: protocolVersion,
    daveProtocolVersion: protocolVersion
  };
}

function getDaveRuntimeSummary() {
  if (!Davey) {
    return {
      available: false,
      protocolVersion: 0,
      packageVersion: "",
      summary: "@snazzah/davey is not installed."
    };
  }

  const protocolVersion = getDaveProtocolVersion();
  return {
    available: true,
    protocolVersion,
    packageVersion: String(Davey.VERSION || ""),
    summary: `Loaded @snazzah/davey ${Davey.VERSION || "unknown"} (protocol v${protocolVersion}).`
  };
}

module.exports = {
  buildVoiceJoinConfig,
  getDaveProtocolVersion,
  getDaveRuntimeSummary
};
