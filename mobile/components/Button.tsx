import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, spacing, themed } from '@/lib/theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  // what happens, for VoiceOver, when the title alone doesn't say
  accessibilityHint?: string;
}

export function Button({ title, onPress, loading, disabled, variant = 'primary', accessibilityHint }: ButtonProps) {
  const isSecondary = variant === 'secondary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        isSecondary ? styles.secondary : styles.primary,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && !loading && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isSecondary ? colors.accent : '#fff'} />
      ) : (
        <Text style={isSecondary ? styles.secondaryText : styles.primaryText}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  base: {
    borderRadius: 16,
    paddingVertical: spacing.md - 1,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.accentFill,
    shadowColor: colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  secondary: {
    backgroundColor: colors.chip,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  disabled: {
    opacity: 0.5,
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '700',
  },
}));
