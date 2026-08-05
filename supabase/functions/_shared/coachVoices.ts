export const COACH_VOICE_PERSONA_IDS = [
  "tyler",
  "devin",
  "maya",
  "ava",
] as const;

export type CoachVoicePersonaId = (typeof COACH_VOICE_PERSONA_IDS)[number];

export interface CoachVoicePersona {
  id: CoachVoicePersonaId;
  coach_name: string;
  display_name: string;
  description: string;
  provider: "cartesia";
  provider_voice_id: string;
  model_id: "sonic-3.5";
  language: "en";
}

interface VoiceDefinition {
  id: CoachVoicePersonaId;
  coachName: string;
  displayName: string;
  description: string;
  environmentKey: string;
  defaultVoiceId: string;
}

const VOICE_DEFINITIONS: readonly VoiceDefinition[] = [
  {
    id: "tyler",
    coachName: "Coach Tyler",
    displayName: "Focused",
    description: "Direct, confident American coach.",
    environmentKey: "CARTESIA_VOICE_TYLER",
    defaultVoiceId: "a5136bf9-224c-4d76-b823-52bd5efcffcc",
  },
  {
    id: "devin",
    coachName: "Coach Devin",
    displayName: "Energetic",
    description: "Conversational, upbeat American coach.",
    environmentKey: "CARTESIA_VOICE_DEVIN",
    defaultVoiceId: "228fca29-3a0a-435c-8728-5cb483251068",
  },
  {
    id: "maya",
    coachName: "Coach Maya",
    displayName: "Supportive",
    description: "Warm, expressive American coach.",
    environmentKey: "CARTESIA_VOICE_MAYA",
    defaultVoiceId: "6ccbfb76-1fc6-48f7-b71d-91ac6298247b",
  },
  {
    id: "ava",
    coachName: "Coach Ava",
    displayName: "Dynamic",
    description: "Bright, positive American coach.",
    environmentKey: "CARTESIA_VOICE_AVA",
    defaultVoiceId: "f786b574-daa5-4673-aa0c-cbe3e8534c02",
  },
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCoachVoicePersonaId(
  value: unknown,
): value is CoachVoicePersonaId {
  return typeof value === "string" &&
    (COACH_VOICE_PERSONA_IDS as readonly string[]).includes(value);
}

export function getCoachVoicePersonas(
  readEnvironment: (key: string) => string | undefined = (key) =>
    Deno.env.get(key),
): readonly CoachVoicePersona[] {
  return VOICE_DEFINITIONS.map((definition) => {
    const configured = readEnvironment(definition.environmentKey)?.trim();
    const providerVoiceId = configured && UUID_PATTERN.test(configured)
      ? configured
      : definition.defaultVoiceId;
    return {
      id: definition.id,
      coach_name: definition.coachName,
      display_name: definition.displayName,
      description: definition.description,
      provider: "cartesia",
      provider_voice_id: providerVoiceId,
      model_id: "sonic-3.5",
      language: "en",
    };
  });
}

export function resolveCoachVoicePersona(
  requested: unknown,
  readEnvironment?: (key: string) => string | undefined,
): CoachVoicePersona {
  const id = isCoachVoicePersonaId(requested) ? requested : "tyler";
  return getCoachVoicePersonas(readEnvironment).find((persona) =>
    persona.id === id
  )!;
}
