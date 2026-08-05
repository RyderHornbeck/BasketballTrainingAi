# Cartesia coach rollout

The Cartesia transport is feature-gated. The client uses Cartesia by default; set
`EXPO_PUBLIC_COACH_VOICE_TRANSPORT=openai_realtime` in the Expo environment to
retain the previous OpenAI Realtime path during device validation.

## Server configuration

Set these Supabase secrets before deploying the new functions:

- `CARTESIA_API_KEY` — required; remains server-only.
- `ANTHROPIC_API_KEY` — required by `coach-turn` for Claude Haiku 4.5.
- `CARTESIA_USD_PER_MILLION_CREDITS` — optional cost-accounting override.
- `CARTESIA_VOICE_TYLER`, `CARTESIA_VOICE_DEVIN`,
  `CARTESIA_VOICE_MAYA`, and `CARTESIA_VOICE_AVA` — optional provider voice-ID
  overrides.

Apply the migrations in timestamp order, then deploy:

```sh
supabase db push
supabase functions deploy coach-agent-session
supabase functions deploy coach-turn
supabase functions deploy coach-provider-usage
supabase functions deploy coach-tools
```

## Native release

`expo-duplex-audio` contains Swift and Kotlin code, so this migration requires a
new iOS/Android binary and cannot be delivered to an older binary by OTA.
Generate and submit the native build through the normal EAS profiles only after
the server rollout is ready.

Start the new binary with
`EXPO_PUBLIC_COACH_VOICE_TRANSPORT=openai_realtime`. On physical speaker and
Bluetooth headphones, verify:

1. microphone permission, capture, playback, route changes, and echo control;
2. make/miss, undo, timer, navigation, completion, and workout-edit commands;
3. streamed Haiku fallback answers and tool confirmations;
4. immediate barge-in during model generation and queued/current speech;
5. reconnects, daily-budget behavior, and provider usage rows.

After validation, remove the rollback value (or set any value other than
`openai_realtime`) in the target Expo environment and publish the client update.
Rollback requires only restoring `openai_realtime`; keep the old
`coach-realtime` function available until Cartesia device testing is complete.
