const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Phosphor's ESM bundle uses extensionless imports that Metro cannot resolve
// reliably. Prefer the package's React Native/CommonJS entry for simulator
// and Expo Go UI previews.
config.resolver.resolverMainFields = ["react-native", "browser", "main"];
config.resolver.assetExts = [...config.resolver.assetExts, "onnx"];

module.exports = config;
