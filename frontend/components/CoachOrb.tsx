import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import React, { useCallback, useEffect, useRef } from "react";
import { Animated, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

export type CoachOrbState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

interface CoachOrbProps {
  size: number;
  state: CoachOrbState;
  volume: number;
  shadowColor?: string;
  style?: StyleProp<ViewStyle>;
}

const VERTEX_SHADER = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// Native port of alexanderqchen/orb-ui's CloudTheme fragment shader. The
// procedural field and animation math are retained; only its palette is orange.
const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_activity;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.52;
  mat2 rotation = mat2(0.80, 0.60, -0.60, 0.80);
  for (int octave = 0; octave < 5; octave++) {
    value += amplitude * noise(p);
    p = rotation * p * 1.92 + vec2(9.7, 4.3);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 centered = uv - 0.5;
  float radius = length(centered);
  float edge = 1.0 - smoothstep(0.488, 0.5, radius);
  if (edge <= 0.0) discard;

  vec2 p = centered * 2.0;
  float t = u_time;
  vec2 warp = vec2(
    fbm(p * 1.02 + vec2(t * 0.34, -t * 0.24)),
    fbm(p * 1.08 + vec2(-t * 0.27, t * 0.32) + vec2(6.7, 2.9))
  );
  vec2 curl = vec2(
    sin(p.y * 2.4 + t * 0.68 + warp.y * 3.2),
    cos(p.x * 2.1 - t * 0.61 + warp.x * 3.0)
  );
  vec2 warped = p + (warp - 0.5) * (1.18 + u_activity * 0.38) + curl * (0.035 + u_activity * 0.07);
  float broad = fbm(warped * 0.92 + vec2(t * 0.14, -t * 0.18));
  float folded = fbm(warped * 1.66 + vec2(-t * 0.23, t * 0.19) + 5.2);
  float field = mix(broad, folded, 0.3 + u_activity * 0.14);

  float horizon = 0.46 + 0.08 * sin((uv.x + warp.x * 0.2) * 5.4 + t * 0.42) + 0.16 * (broad - 0.5);
  float upper = smoothstep(horizon - 0.12, horizon + 0.08, uv.y);
  float band = exp(-pow((uv.y - horizon) * (5.2 + u_activity * 0.8), 2.0));
  float cloud = smoothstep(0.24, 0.79, field);

  vec3 deepOrange = vec3(0.604, 0.204, 0.071);
  vec3 mainOrange = vec3(0.976, 0.451, 0.086);
  vec3 lightOrange = vec3(0.992, 0.729, 0.455);
  vec3 highlightOrange = vec3(1.0, 0.647, 0.31);

  vec3 color = mix(lightOrange, mainOrange, upper);
  float upperDepth = upper * (0.14 + smoothstep(0.42, 0.78, folded) * 0.5);
  color = mix(color, deepOrange, upperDepth);
  float highlightAmount = clamp(band * (0.42 + cloud * 0.62), 0.0, 0.88);
  color = mix(color, highlightOrange, highlightAmount);
  float lowerMist = (1.0 - upper) * smoothstep(0.58, 0.9, broad) * 0.18;
  color = mix(color, lightOrange, lowerMist);
  color += (noise(gl_FragCoord.xy * 0.64) - 0.5) / 255.0;
  gl_FragColor = vec4(color, edge);
}
`;

function compileShader(gl: ExpoWebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create coach orb shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader error.";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export function CoachOrb({
  size,
  state,
  volume,
  shadowColor = "#F97316",
  style,
}: CoachOrbProps) {
  const stateRef = useRef(state);
  const volumeRef = useRef(volume);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    stateRef.current = state;
    volumeRef.current = Math.min(1, Math.max(0, volume));
  }, [state, volume]);

  useEffect(() => () => {
    if (animationFrameRef.current != null) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const onContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    try {
      const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      const program = gl.createProgram();
      const buffer = gl.createBuffer();
      if (!program || !buffer) throw new Error("Unable to initialize coach orb buffers.");

      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Unable to link coach orb shader.");

      const positionLocation = gl.getAttribLocation(program, "a_position");
      const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
      const timeLocation = gl.getUniformLocation(program, "u_time");
      const activityLocation = gl.getUniformLocation(program, "u_activity");
      if (positionLocation < 0 || !resolutionLocation || !timeLocation || !activityLocation) {
        throw new Error("Unable to locate coach orb shader uniforms.");
      }

      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resolutionLocation, gl.drawingBufferWidth, gl.drawingBufferHeight);

      let previousTime = Date.now();
      let flowTime = 0;
      const render = () => {
        const now = Date.now();
        const deltaSeconds = Math.min((now - previousTime) / 1_000, 0.05);
        previousTime = now;
        const currentState = stateRef.current;
        const currentVolume = volumeRef.current;
        const isListening = currentState === "listening";
        const isSpeaking = currentState === "speaking";
        const speed = isSpeaking ? 1.65 + currentVolume * 1.55 : isListening ? 0.72 + currentVolume * 0.78 : 0.24;
        const activity = isSpeaking ? 0.66 + currentVolume * 0.34 : isListening ? 0.28 + currentVolume * 0.32 : 0.1;
        flowTime += deltaSeconds * speed;
        gl.uniform1f(timeLocation, flowTime);
        gl.uniform1f(activityLocation, activity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.endFrameEXP();
        animationFrameRef.current = requestAnimationFrame(render);
      };
      render();
    } catch (error) {
      console.warn("Unable to initialize Court Coach cloud orb:", error);
    }
  }, []);

  const radius = size / 2;
  return (
    <Animated.View
      style={[
        styles.orb,
        {
          width: size,
          height: size,
          borderRadius: radius,
          shadowColor,
        },
        style,
      ]}
    >
      <GLView style={styles.surface} onContextCreate={onContextCreate} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  orb: {
    overflow: "hidden",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.42,
    shadowRadius: 24,
    elevation: 14,
  },
  surface: { flex: 1 },
});
