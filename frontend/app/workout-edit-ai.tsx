import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { emitWorkoutUpdated } from "@/lib/coachEvents";
import { supabase } from "@/lib/supabase";
import { ArrowLeftIcon, PaperPlaneRightIcon } from "phosphor-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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
}

export default function WorkoutEditAIScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { dayId } = useLocalSearchParams<{ dayId?: string }>();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [remaining, setRemaining] = useState(50);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dayId) return;
    void supabase
      .from("workout_edit_messages")
      .select("id, role, content")
      .eq("day_id", dayId)
      .order("created_at", { ascending: true })
      .limit(100)
      .then(({ data }) => setMessages((data as ChatMessage[]) ?? []));
  }, [dayId]);

  const send = async () => {
    const content = draft.trim();
    if (!dayId || !content || sending || remaining <= 0) return;
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
        },
      ]);
      setRemaining(data?.remaining_messages ?? Math.max(0, remaining - 1));
      emitWorkoutUpdated();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not update workout.");
    } finally {
      setSending(false);
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
          <Text style={[styles.limit, { color: colors.textMuted }]}>{remaining} messages left today</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
      >
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
              <Text style={{ color: item.role === "user" ? "#FFFFFF" : colors.text }}>
                {item.content}
              </Text>
            </View>
          )}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={[styles.composer, { borderTopColor: colors.border }]}>
          <TextInput
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
            style={[
              styles.sendButton,
              {
                backgroundColor: colors.accent,
                opacity: !draft.trim() || sending || remaining <= 0 ? 0.45 : 1,
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
  headerSpacer: { width: 24 },
  title: { fontSize: 19, fontWeight: "800" },
  limit: { fontSize: 11, fontWeight: "600", marginTop: 1 },
  messages: { flexGrow: 1, padding: 18, gap: 10 },
  emptyCard: { marginTop: 30, borderRadius: 20, padding: 20 },
  emptyTitle: { fontSize: 17, fontWeight: "800" },
  emptyText: { marginTop: 6, fontSize: 13, lineHeight: 19 },
  bubble: { maxWidth: "84%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 11 },
  userBubble: { alignSelf: "flex-end", borderBottomRightRadius: 5 },
  assistantBubble: { alignSelf: "flex-start", borderBottomLeftRadius: 5, borderWidth: 1 },
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
