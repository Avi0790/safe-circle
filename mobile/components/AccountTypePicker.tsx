import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ACCOUNT_TYPES, type AccountType } from '@/lib/accountType';
import { colors, spacing, themed, typography } from '@/lib/theme';

export function AccountTypePicker({
  value,
  onChange,
}: {
  value: AccountType;
  onChange: (next: AccountType) => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>How will you use Safe Circle?</Text>
      {ACCOUNT_TYPES.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            style={[styles.card, selected && styles.cardSelected]}
          >
            <Text allowFontScaling={false} style={styles.emoji}>{option.emoji}</Text>
            <View style={styles.text}>
              <Text style={styles.title}>{option.title}</Text>
              <Text style={typography.caption}>{option.description}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  container: { gap: spacing.sm },
  label: { ...typography.caption, color: colors.textHeading, fontWeight: '700' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 18,
    padding: spacing.md - 2,
    backgroundColor: colors.input,
  },
  cardSelected: { borderColor: colors.accent, backgroundColor: colors.tint },
  emoji: { fontSize: 26 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '700', color: colors.textHeading },
}));
