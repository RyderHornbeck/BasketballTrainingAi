// Drop-in replacement for React Native's <Text> that applies the app's
// premium font (Poppins) automatically based on whatever `fontWeight` the
// caller already specifies. React 19 removed support for defaultProps on
// components, so this is the standard way to apply a global custom font
// without having to touch every single style definition in the app.
import React from "react";
import { StyleSheet, Text as RNText, TextProps } from "react-native";

const WEIGHT_TO_FONT: Record<string, string> = {
  "100": "Poppins_400Regular",
  "200": "Poppins_400Regular",
  "300": "Poppins_400Regular",
  "400": "Poppins_400Regular",
  normal: "Poppins_400Regular",
  "500": "Poppins_500Medium",
  "600": "Poppins_600SemiBold",
  "700": "Poppins_700Bold",
  bold: "Poppins_700Bold",
  "800": "Poppins_800ExtraBold",
  "900": "Poppins_800ExtraBold",
};

export function Text({ style, ...rest }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  const fontFamily = flat.fontFamily ?? WEIGHT_TO_FONT[String(flat.fontWeight ?? "400")] ?? "Poppins_400Regular";

  return <RNText {...rest} style={[style, { fontFamily }]} />;
}
