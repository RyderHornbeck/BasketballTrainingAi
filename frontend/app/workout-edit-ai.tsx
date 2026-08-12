import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { hasCurrentAIDataConsent } from "@/lib/aiDataConsent";
import { reportNetworkFailure } from "@/lib/connectivity";
import { emitWorkoutUpdated } from "@/lib/coachEvents";
import { actionHaptic } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { ArrowCounterClockwiseIcon, ArrowLeftIcon, PaperPlaneRightIcon } from "phosphor-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  animate?: boolean;
}

const MAX_MESSAGES_PER_WORKOUT = 30;

function TypingBubble({ colors }: { colors: ReturnType<typeof useTheme>["colors"] }) {
  const [dotOne] = useState(() => new Animated.Value(0));
  const [dotTwo] = useState(() => new Animated.Value(0));
  const [dotThree] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const dots = [dotOne, dotTwo, dotThree];
    const animations = dots.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 120),
          Animated.timing(dot, {
            toValue: -5,
            duration: 210,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 210,
            useNativeDriver: true,
          }),
          Animated.delay((2 - index) * 120),
        ])
      )
    );
    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [dotOne, dotThree, dotTwo]);

  return (
    <View
      accessibilityLabel="AI is typing"
      style={[styles.typingBubble, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      {[dotOne, dotTwo, dotThree].map((dot, index) => (
        <Animated.View
          key={index}
          style={[
            styles.typingDot,
            { backgroundColor: colors.textMuted, transform: [{ translateY: dot }] },
          ]}
        />
      ))}
    </View>
  );
}

function MarkdownText({
  content,
  color,
}: {
  content: string;
  color: string;
}) {
  const renderInline = (line: string) => {
    const segments = line.split(/(\*\*[^*]+\*\*)/g);
    return segments.map((segment, index) => {
      const bold = /^\*\*[^*]+\*\*$/.test(segment);
      return (
        <Text key={`${index}-${segment}`} style={[styles.messageText, { color, fontWeight: bold ? "700" : "400" }]}>
          {bold ? segment.slice(2, -2) : segment}
        </Text>
      );
    });
  };

  return (
    <View style={styles.markdownContent}>
      {content.split("\n").map((line, index) => {
        const bullet = /^[-*]\s+/.exec(line);
        const text = bullet ? line.slice(bullet[0].length) : line;
        return (
          <View key={`${index}-${line}`} style={bullet ? styles.bulletLine : styles.messageLine}>
            {bullet ? <Text style={[styles.messageText, styles.bulletMarker, { color }]}>•</Text> : null}
            <Text style={[styles.messageText, bullet ? styles.bulletText : undefined, { color }]}>
              {renderInline(text)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function AssistantMessageText({
  content,
  animate,
  color,
}: {
  content: string;
  animate?: boolean;
  color: string;
}) {
  const words = content.match(/\S+\s*/g) ?? [];
  const [visibleWords, setVisibleWords] = useState(animate ? 0 : words.length);

  useEffect(() => {
    if (!animate) {
      setVisibleWords(words.length);
      return;
    }
    setVisibleWords(0);
    const timer = setInterval(() => {
      setVisibleWords((current) => {
        if (current >= words.length) {
          clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [animate, content, words.length]);

  return <MarkdownText content={words.slice(0, visibleWords).join("")} color={color} />;
}

export default function WorkoutEditAIScreen() {
  const { colors } = useTheme();
  const { profile } = useAuth();
  const router = useRouter();
  const { dayId } = useLocalSearchParams<{ dayId?: string }>();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [remaining, setRemaining] = useState(MAX_MESSAGES_PER_WORKOUT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dayId || !profile) return;
    if (!hasCurrentAIDataConsent(profile)) {
      router.replace({
        pathname: "/ai-data-processing",
        params: { source: "settings" },
      });
      return;
    }
    void Promise.all([
      supabase
        .from("workout_edit_messages")
        .select("id, role, content")
        .eq("day_id", dayId)
        .order("created_at", { ascending: true })
        .limit(100),
      supabase.functions.invoke<{ can_undo?: boolean; remaining_messages?: number }>("workout-editor", {
        body: { action: "status", day_id: dayId },
      }),
    ]).then(([{ data }, { data: status }]) => {
      const loadedMessages = (data as ChatMessage[]) ?? [];
      setMessages(loadedMessages);
      setCanUndo(Boolean(status?.can_undo));
      setRemaining(
        status?.remaining_messages ??
          Math.max(
            0,
            MAX_MESSAGES_PER_WORKOUT -
              loadedMessages.filter((message) => message.role === "user").length
          )
      );
    });
  }, [dayId, profile, router]);

  useEffect(() => {
    const scrollToLatest = () => {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 80);
    };
    scrollToLatest();
    const keyboardWillShow = Keyboard.addListener("keyboardWillShow", scrollToLatest);
    const keyboardDidShow = Keyboard.addListener("keyboardDidShow", scrollToLatest);
    return () => {
      keyboardWillShow.remove();
      keyboardDidShow.remove();
    };
  }, [messages.length, sending]);

  const send = async () => {
    const content = draft.trim();
    if (!dayId || !content || sending || remaining <= 0) return;
    actionHaptic();
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content,
    };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setSending(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{
        reply?: string;
        remaining_messages?: number;
        can_undo?: boolean;
        error?: string;
      }>("workout-editor", {
        body: {
          day_id: dayId,
          message: content,
          request_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          timezone_offset_minutes: new Date().getTimezoneOffset(),
        },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: data?.reply ?? "Your workout has been updated.",
          animate: true,
        },
      ]);
      setRemaining(data?.remaining_messages ?? Math.max(0, remaining - 1));
      setCanUndo(Boolean(data?.can_undo));
      emitWorkoutUpdated();
    } catch (sendError) {
      reportNetworkFailure("workout-editor");
      setError(sendError instanceof Error ? sendError.message : "Could not update workout.");
    } finally {
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const undoLastEdit = async () => {
    if (!dayId || undoing || !canUndo) return;
    setUndoing(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{
        reply?: string;
        changes?: string[];
        can_undo?: boolean;
        error?: string;
      }>("workout-editor", {
        body: { action: "undo", day_id: dayId },
      });
      if (invokeError) {
        const response = (invokeError as { context?: Response }).context;
        const errorBody = response ? await response.clone().json().catch(() => null) : null;
        throw new Error(errorBody?.error ?? invokeError.message);
      }
      if (data?.error) throw new Error(data.error);
      setMessages((current) => [
        ...current,
        {
          id: `undo-${Date.now()}`,
          role: "assistant",
          content: data?.reply ?? "Undid the last AI workout edit.",
          animate: true,
        },
      ]);
      setCanUndo(Boolean(data?.can_undo));
      emitWorkoutUpdated();
    } catch (undoError) {
      reportNetworkFailure("workout-editor");
      setError(undoError instanceof Error ? undoError.message : "Could not undo the last AI edit.");
    } finally {
      setUndoing(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <ArrowLeftIcon size={24} color={colors.text} weight="bold" />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>Edit with AI</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Undo last AI workout edit"
          disabled={!canUndo || undoing}
          onPress={() => void undoLastEdit()}
          style={({ pressed }) => [
            styles.undoButton,
            {
              borderColor: colors.border,
              opacity: !canUndo || undoing ? 0.4 : pressed ? 0.72 : 1,
            },
          ]}
        >
          {undoing ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <>
              <ArrowCounterClockwiseIcon size={16} color={colors.accent} weight="bold" />
              <Text style={[styles.undoText, { color: colors.accent }]}>Undo</Text>
            </>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
      >
        {remaining <= 0 ? (
          <View
            style={[
              styles.limitBubble,
              { backgroundColor: colors.accentMuted, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.limitText, { color: colors.text }]}>
              All Edits with AI have been used for this workout.
            </Text>
          </View>
        ) : null}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Describe your changes</Text>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                Try “Remove one conditioning drill and add a left-wing shooting drill.”
              </Text>
            </View>
          }
          ListFooterComponent={sending ? <TypingBubble colors={colors} /> : null}
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === "user" ? styles.userBubble : styles.assistantBubble,
                {
                  backgroundColor: item.role === "user" ? colors.accent : colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              {item.role === "assistant" ? (
                <AssistantMessageText
                  content={item.content}
                  animate={item.animate}
                  color={colors.text}
                />
              ) : (
                <Text style={[styles.messageText, { color: "#FFFFFF" }]}>{item.content}</Text>
              )}
            </View>
          )}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={[styles.composer, { borderTopColor: colors.border }]}>
          <TextInput
            allowFontScaling={false}
            maxFontSizeMultiplier={1}
            value={draft}
            onChangeText={setDraft}
            placeholder="Describe what you want to change..."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={1200}
            style={[
              styles.input,
              { backgroundColor: colors.card, borderColor: colors.border, color: colors.text },
            ]}
          />
          <Pressable
            disabled={!draft.trim() || sending || remaining <= 0}
            onPress={() => void send()}
            style={({ pressed }) => [
              styles.sendButton,
              {
                backgroundColor: colors.accent,
                opacity:
                  !draft.trim() || sending || remaining <= 0 ? 0.45 : pressed ? 0.72 : 1,
              },
            ]}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <PaperPlaneRightIcon size={20} color="#FFFFFF" weight="fill" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    minHeight: 58,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  headerCopy: { flex: 1, alignItems: "center" },
  undoButton: {
    minWidth: 62,
    height: 32,
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  undoText: { fontSize: 12, fontWeight: "800" },
  title: { fontSize: 19, fontWeight: "800" },
  messages: { flexGrow: 1, padding: 18, gap: 10 },
  emptyCard: { marginTop: 30, borderRadius: 20, padding: 20 },
  emptyTitle: { fontSize: 17, fontWeight: "800" },
  emptyText: { marginTop: 6, fontSize: 13, lineHeight: 19 },
  bubble: {
    maxWidth: "84%",
    minWidth: 0,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  markdownContent: { width: "100%", flexShrink: 1 },
  messageLine: { width: "100%", flexShrink: 1 },
  messageText: { flexShrink: 1, fontSize: 14, lineHeight: 21 },
  bulletLine: { width: "100%", flexDirection: "row", flexShrink: 1, marginTop: 2 },
  bulletMarker: { width: 16, fontWeight: "700" },
  bulletText: { flex: 1, minWidth: 0 },
  userBubble: { alignSelf: "flex-end", borderBottomRightRadius: 5 },
  assistantBubble: {
    alignSelf: "flex-start",
    width: "84%",
    borderBottomLeftRadius: 5,
    borderWidth: 1,
  },
  typingBubble: {
    alignSelf: "flex-start",
    minWidth: 62,
    height: 42,
    borderRadius: 18,
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  typingDot: { width: 6, height: 6, borderRadius: 3 },
  limitBubble: {
    alignSelf: "center",
    marginHorizontal: 18,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 18,
  },
  limitText: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 9,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 17,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  error: { color: "#DC2626", fontSize: 12, paddingHorizontal: 18, paddingBottom: 4 },
});
