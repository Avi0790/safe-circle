import { useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { findFaqAnswer, HELP_FAQ, HELP_FALLBACK_ANSWER } from '@/lib/helpFaq';
import { colors, radius, spacing, typography } from '@/lib/theme';

interface DisplayTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const STARTER_QUESTIONS = HELP_FAQ.slice(0, 4).map((entry) => entry.question);

// In-app help — for "how do I..." questions about Safe Circle itself, not a
// substitute for the SOS button. This is a free, fully offline keyword
// matcher (lib/helpFaq.ts), not a live AI model: an earlier version called
// Anthropic's API (still in backend/supabase/functions/send-ai-help, unused
// by this screen for now), but a real per-question cost isn't worth it for
// a capstone demo someone could forget to keep funded before presenting.
// Chat history is kept in memory only — nothing is saved anywhere.
export default function AiHelpScreen() {
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList>(null);

  function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    const answer = findFaqAnswer(trimmed) ?? HELP_FALLBACK_ANSWER;
    setTurns((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: trimmed },
      { id: `a-${Date.now() + 1}`, role: 'assistant', content: answer },
    ]);
    setDraft('');
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Help' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={listRef}
          data={turns}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.role === 'user' ? styles.bubbleMine : styles.bubbleTheirs]}>
              <Text style={item.role === 'user' ? styles.bubbleTextMine : styles.bubbleTextTheirs}>
                {item.content}
              </Text>
            </View>
          )}
          ListHeaderComponent={
            <View style={styles.intro}>
              <Text style={typography.body}>
                Ask how something in Safe Circle works — free and built into the app, no internet
                needed. This isn't monitored by your circle and isn't for emergencies — use the SOS
                button for those.
              </Text>
              {turns.length === 0 && (
                <View style={styles.starters}>
                  {STARTER_QUESTIONS.map((q) => (
                    <Pressable key={q} style={styles.starterChip} onPress={() => send(q)}>
                      <Text style={styles.starterText}>{q}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          }
        />

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask a question…"
            placeholderTextColor={colors.offline}
            multiline
            maxLength={200}
          />
          <Pressable
            style={[styles.sendButton, !draft.trim() && styles.sendButtonDisabled]}
            onPress={() => send(draft)}
            disabled={!draft.trim()}
          >
            <Text style={styles.sendButtonText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm, flexGrow: 1 },
  intro: { gap: spacing.md, marginBottom: spacing.md },
  starters: { gap: spacing.sm },
  starterChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  starterText: { color: colors.accent, fontWeight: '600', fontSize: 14 },
  bubble: { borderRadius: radius.md, paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm, marginBottom: spacing.xs, maxWidth: '85%' },
  bubbleTheirs: { backgroundColor: colors.bgElevated, alignSelf: 'flex-start', borderBottomLeftRadius: 2 },
  bubbleMine: { backgroundColor: colors.accent, alignSelf: 'flex-end', borderBottomRightRadius: 2 },
  bubbleTextTheirs: { fontSize: 15, color: colors.textHeading },
  bubbleTextMine: { fontSize: 15, color: '#fff' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.textHeading,
  },
  sendButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  sendButtonDisabled: { opacity: 0.5 },
  sendButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
