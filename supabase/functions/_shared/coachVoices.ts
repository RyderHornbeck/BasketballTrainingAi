export const COACH_VOICE_PERSONA_IDS = ["tyler", "devin", "maya", "ava"] as const;

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
    description: "Direct, steady, and encouraging.",
    environmentKey: "CARTESIA_VOICE_TYLER",
    defaultVoiceId: "a5136bf9-224c-4d76-b823-52bd5efcffcc",
  },
  {
    id: "devin",
    coachName: "Coach Devin",
    displayName: "Energetic",
    description: "Upbeat, expressive, and motivating.",
    environmentKey: "CARTESIA_VOICE_DEVIN",
    defaultVoiceId: "ef191366-f52f-447a-a398-ed8c0f2943a1",
  },
  {
    id: "maya",
    coachName: "Coach Maya",
    displayName: "Supportive",
    description: "Warm, clear, and reassuring.",
    environmentKey: "CARTESIA_VOICE_MAYA",
    defaultVoiceId: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4",
  },
  {
    id: "ava",
    coachName: "Coach Ava",
    displayName: "Dynamic",
    description: "Expressive, positive, and conversational.",
    environmentKey: "CARTESIA_VOICE_AVA",
    defaultVoiceId: "f786b574-daa5-4673-aa0c-cbe3e8534c02",
  },
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCoachVoicePersonaId(value: unknown): value is CoachVoicePersonaId {
  return typeof value === "string" &&
    (COACH_VOICE_PERSONA_IDS as readonly string[]).includes(value);
}

export function getCoachVoicePersonas(
  readEnvironment: (key: string) => string | undefined = (key) => Deno.env.get(key),
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
  return getCoachVoicePersonas(readEnvironment).find((persona) => persona.id === id)!;
}
