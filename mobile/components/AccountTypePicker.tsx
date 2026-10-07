import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ACCOUNT_TYPES, type AccountType } from '@/lib/accountType';
import { colors, radius, spacing, typography } from '@/lib/theme';

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
            <Text style={styles.emoji}>{option.emoji}</Text>
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

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  label: { ...typography.caption, color: colors.textHeading, fontWeight: '600' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.bg,
  },
  cardSelected: { borderColor: colors.accent, backgroundColor: colors.bgElevated, borderWidth: 2 },
  emoji: { fontSize: 26 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600', color: colors.textHeading },
});
