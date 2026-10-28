import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import type { ColorValue } from 'react-native';
import { useAccount } from '@/contexts/AccountContext';
import { useCircles } from '@/contexts/CircleContext';
import { ChatReadProvider, useChatRead } from '@/contexts/ChatReadContext';
import { colors, useThemeVersion } from '@/lib/theme';

// Emoji ignore the tint colour, so the tab you're not on is faded instead.
function TabIcon({ symbol, color, focused }: { symbol: string; color: ColorValue; focused: boolean }) {
  return <Text style={{ fontSize: 21, color, opacity: focused ? 1 : 0.45 }}>{symbol}</Text>;
}

export default function TabsLayout() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const { selectedCircleId } = useCircles();
  return (
    <ChatReadProvider circleId={selectedCircleId}>
      <TabsWithChatBadge />
    </ChatReadProvider>
  );
}

// Split from TabsLayout because the badge count comes from
// ChatReadProvider's context, which a component can only read from
// *inside* the provider, not the component establishing it.
function TabsWithChatBadge() {
  const { unreadCount } = useChatRead();
  const { accountType, hasActiveOrg } = useAccount();

  return (
    <Tabs
      // Work-crew members open on the Work tab; everyone else on the map.
      initialRouteName={accountType === 'industry' && hasActiveOrg ? 'work' : 'index'}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.line },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Map',
          tabBarIcon: ({ color, focused }) => <TabIcon focused={focused} symbol="📍" color={color} />,
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: 'Work',
          // Only for people who belong to an organization.
          href: hasActiveOrg ? undefined : null,
          tabBarIcon: ({ color, focused }) => <TabIcon focused={focused} symbol="🦺" color={color} />,
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: 'Members',
          tabBarIcon: ({ color, focused }) => <TabIcon focused={focused} symbol="👥" color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color, focused }) => <TabIcon focused={focused} symbol="💬" color={color} />,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => <TabIcon focused={focused} symbol="⚙️" color={color} />,
        }}
      />
    </Tabs>
  );
}
