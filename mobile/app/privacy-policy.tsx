import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '@/lib/i18n';
import { POLICY, POLICY_FILL, POLICY_UPDATED } from '@/lib/privacyPolicy';
import { colors, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

// The privacy policy (lib/privacyPolicy.ts). Outside the sign-in guard in
// app/_layout.tsx, like reset-password: people read it before signing up.
export default function PrivacyPolicyScreen() {
  useThemeVersion(); // redraw on a theme or language switch (lib/theme.ts)
  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('Privacy policy'), headerBackTitle: t('Back') }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.caption}>{t('Last updated {date}', { date: POLICY_UPDATED })}</Text>
        {POLICY.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.heading} accessibilityRole="header">
              {t(section.title)}
            </Text>
            {section.items.map((item) => (
              <Text key={item} style={styles.item}>
                •  {t(item, POLICY_FILL)}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
  section: { gap: spacing.sm },
  heading: { ...typography.heading, color: colors.textHeading },
  item: { ...typography.body, lineHeight: 22 },
}));
