import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { PRIVACY_LIMITS, PRIVACY_NOT_DONE, PRIVACY_SECTIONS } from '@/lib/privacyInfo';
import { colors, radius, spacing, themed, typography, useThemeVersion } from '@/lib/theme';
import { t } from '@/lib/i18n';

// A plain-language tour of what protects you and where the controls live.
// Content lives in lib/privacyInfo.ts so it can be tested against the real
// routes — every button here has to go somewhere that exists.
export default function PrivacyScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'How your privacy works' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.body}>
          {t("Safe Circle shares your location only with people you choose, and you stay in control of it. Here's what protects you — and where to change it.")}
        </Text>

        {PRIVACY_SECTIONS.map((section) => (
          <View key={section.id} style={styles.card}>
            <Text style={styles.cardTitle}>
              {section.emoji} {section.title}
            </Text>
            <Text style={typography.body}>{section.body}</Text>
            {section.action && (
              <Button
                title={section.action.label}
                variant="secondary"
                onPress={() => router.push(section.action!.route as Href)}
              />
            )}
          </View>
        ))}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("🚫 What we don't do")}</Text>
          <Text style={typography.body}>{PRIVACY_NOT_DONE}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('⚠️ Honest limits')}</Text>
          {PRIVACY_LIMITS.map((limit) => (
            <Text key={limit} style={typography.body}>
              • {limit}
            </Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: typography.heading,
}));
