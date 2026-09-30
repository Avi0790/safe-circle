import { useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { askHelp, type ChatTurn } from '@/lib/aiHelp';
import { colors, radius, spacing, typography } from '@/lib/theme';

interface DisplayTurn extends ChatTurn {
  id: string;
}

const STARTER_QUESTIONS = ['What does Ghost Mode do?', 'How does Walk me home work?', 'How do I set a curfew?'];

// An in-app help chatbot — for "how do I..." questions about Safe Circle
// itself, not a substitute for the SOS button. Backed by
// backend/supabase/functions/send-ai-help, the only Edge Function in this
// app called directly by the client rather than by a database trigger.
// Chat history is kept in memory only (not saved anywhere) — this is a
// stateless FAQ helper, not something that needs to persist between visits.
export default function AiHelpScreen() {
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  async function send(question: string) {
    if (!question.trim() || sending) return;
    setError(null);
    setSending(true);
    const userTurn: DisplayTurn = { id: `u-${Date.now()}`, role: 'user', content: question.trim() };
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((prev) => [...prev, userTurn]);
    setDraft('');

    const result = await askHelp(question, history);
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTurns((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: result.answer }]);
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
                Ask how something in Safe Circle works. This isn't monitored by your circle and
                isn't for emergencies — use the SOS button for those.
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
          ListFooterComponent={
            sending ? (
              <View style={[styles.bubble, styles.bubbleTheirs]}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            ) : null
          }
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask a question…"
            placeholderTextColor={colors.offline}
            multiline
            maxLength={500}
          />
          <Pressable
            style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
            onPress={() => send(draft)}
            disabled={!draft.trim() || sending}
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
  error: { color: colors.danger, fontSize: 13, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
});
