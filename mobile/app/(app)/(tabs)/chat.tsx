import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { useChatRead } from '@/contexts/ChatReadContext';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { useCircleMessages } from '@/hooks/useCircleMessages';
import { Avatar } from '@/components/Avatar';
import { appColors } from '@/components/ui/AppUI';
import { timeAgo } from '@/lib/format';
import type { Message } from '@/lib/types';
import { colors, spacing, typography } from '@/lib/theme';

// In-circle chat — Life360's most-used feature, and one the proposal never
// scoped in: circles could share location and alerts but had no way to
// actually talk without leaving the app. See backend/supabase/migrations/
// ...000016_messages.sql for the (deliberately append-only) schema.
export default function ChatTab() {
  const { session } = useAuth();
  const { selectedCircle } = useCircles();
  const { members } = useCircleMembers(selectedCircle?.id ?? null);
  const { messages, isLoading, error, send, checkIn } = useCircleMessages(selectedCircle?.id ?? null);
  const { markRead } = useChatRead();
  const isFocused = useIsFocused();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const listRef = useRef<FlatList>(null);
  // Only auto-scroll to new messages when already near the bottom — a
  // naive "always scroll on content change" would yank someone back down
  // mid-scroll while they're reading older history.
  const isNearBottomRef = useRef(true);

  // Tabs stay mounted in the background, so this screen keeps receiving
  // new messages via realtime even while another tab is in front — only
  // mark as read while this screen is the one actually on screen, on
  // first arriving here and on every new message after that.
  useEffect(() => {
    if (!isFocused) return;
    markRead();
  }, [isFocused, messages.length, markRead]);

  const memberById = new Map(members.map((m) => [m.id, m]));

  async function handleSend() {
    if (!draft.trim() || sending) return;
    setSending(true);
    setSendError(null);
    const result = await send(draft);
    setSending(false);
    if (!result.ok) {
      setSendError(result.error);
      return;
    }
    setDraft('');
  }

  async function handleCheckIn() {
    if (checkingIn) return;
    setCheckingIn(true);
    setSendError(null);
    const result = await checkIn();
    setCheckingIn(false);
    if (!result.ok) setSendError(result.error);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.header}>
          <Text style={styles.kicker}>CIRCLE CHAT</Text>
          <Text style={styles.title}>{selectedCircle?.name ?? 'Chat'}</Text>
          <Text style={styles.subtitle}>
            {members.length} {members.length === 1 ? 'person' : 'people'} · only your circle can read this
          </Text>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          onScroll={({ nativeEvent }) => {
            const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
            const distanceFromBottom =
              contentSize.height - contentOffset.y - layoutMeasurement.height;
            isNearBottomRef.current = distanceFromBottom < 80;
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (isNearBottomRef.current) {
              listRef.current?.scrollToEnd({ animated: true });
            }
          }}
          renderItem={({ item }) => (
            <MessageRow
              message={item}
              senderName={memberById.get(item.user_id)?.full_name ?? 'Someone'}
              senderAvatarUrl={memberById.get(item.user_id)?.avatar_url ?? null}
              isMine={item.user_id === session?.user.id}
            />
          )}
          ListEmptyComponent={
            !isLoading ? (
              <Text style={[typography.caption, styles.emptyText]}>
                No messages yet — say hi to your circle.
              </Text>
            ) : null
          }
        />

        <View style={styles.composer}>
          <Pressable
            style={[styles.checkInButton, checkingIn && styles.sendButtonDisabled]}
            onPress={handleCheckIn}
            disabled={checkingIn}
            accessibilityLabel="Check in — share where you are with your circle"
          >
            {checkingIn ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Text style={styles.checkInText}>📍</Text>
            )}
          </Pressable>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message your circle…"
            placeholderTextColor={colors.offline}
            multiline
            maxLength={2000}
          />
          <Pressable
            style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.sendButtonText}>↑</Text>
            )}
          </Pressable>
        </View>
        {sendError && <Text style={styles.error}>{sendError}</Text>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageRow({
  message,
  senderName,
  senderAvatarUrl,
  isMine,
}: {
  message: Message;
  senderName: string;
  senderAvatarUrl: string | null;
  isMine: boolean;
}) {
  return (
    <View style={[styles.messageRow, isMine && styles.messageRowMine]}>
      {!isMine && <Avatar id={message.user_id} name={senderName} url={senderAvatarUrl} size={28} />}
      <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!isMine && <Text style={styles.senderName}>{senderName}</Text>}
        <Text style={isMine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>
          {message.body}
        </Text>
        {message.latitude != null && message.longitude != null && (
          <Pressable
            onPress={() =>
              Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${message.latitude},${message.longitude}`,
              ).catch(() => {})
            }
          >
            <Text style={isMine ? styles.mapLinkMine : styles.mapLinkTheirs}>View on map ›</Text>
          </Pressable>
        )}
        <Text style={isMine ? styles.timeMine : styles.timeTheirs}>
          {timeAgo(message.created_at)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: appColors.page },
  flex: { flex: 1 },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: 2 },
  kicker: { fontSize: 13, fontWeight: '700', color: appColors.muted, letterSpacing: 0.6 },
  title: { fontSize: 32, fontWeight: '800', color: appColors.ink, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: appColors.muted },
  list: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm + 2, flexGrow: 1 },
  emptyText: { textAlign: 'center', marginTop: spacing.xl },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, maxWidth: '85%' },
  messageRowMine: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  bubble: { borderRadius: 20, paddingHorizontal: spacing.md - 2, paddingVertical: spacing.sm + 2, gap: 3 },
  bubbleTheirs: {
    backgroundColor: colors.card,
    borderBottomLeftRadius: 6,
    shadowColor: '#1e1b4b',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  bubbleMine: { backgroundColor: colors.accentFill, borderBottomRightRadius: 6 },
  senderName: { fontSize: 12, fontWeight: '700', color: colors.accent },
  bubbleTextTheirs: { fontSize: 16, color: colors.textHeading, lineHeight: 22 },
  bubbleTextMine: { fontSize: 16, color: '#fff', lineHeight: 22 },
  timeTheirs: { fontSize: 11, color: appColors.muted, alignSelf: 'flex-end' },
  timeMine: { fontSize: 11, color: '#fff', opacity: 0.8, alignSelf: 'flex-end' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: 6,
    borderRadius: 28,
    backgroundColor: colors.card,
    shadowColor: '#1e1b4b',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    paddingHorizontal: spacing.sm,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    color: colors.textHeading,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  checkInButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkInText: { fontSize: 18 },
  mapLinkTheirs: { fontSize: 13, fontWeight: '700', color: colors.accent },
  mapLinkMine: { fontSize: 13, fontWeight: '700', color: '#fff', textDecorationLine: 'underline' },
  sendButtonText: { color: '#fff', fontWeight: '800', fontSize: 20, marginTop: -2 },
  error: { color: colors.danger, fontSize: 13, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
});
