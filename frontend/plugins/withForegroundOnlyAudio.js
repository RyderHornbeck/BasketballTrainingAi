const { withInfoPlist } = require("expo/config-plugins");

module.exports = function withForegroundOnlyAudio(config) {
  return withInfoPlist(config, (nextConfig) => {
    const modes = Array.isArray(nextConfig.modResults.UIBackgroundModes)
      ? nextConfig.modResults.UIBackgroundModes
      : [];
    const remainingModes = modes.filter((mode) => mode !== "audio");

    if (remainingModes.length > 0) {
      nextConfig.modResults.UIBackgroundModes = remainingModes;
    } else {
      delete nextConfig.modResults.UIBackgroundModes;
    }

    return nextConfig;
  });
};
