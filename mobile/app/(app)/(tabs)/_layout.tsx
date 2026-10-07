import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import type { ColorValue } from 'react-native';
import { useAccount } from '@/contexts/AccountContext';
import { useCircles } from '@/contexts/CircleContext';
import { ChatReadProvider, useChatRead } from '@/contexts/ChatReadContext';
import { colors } from '@/lib/theme';

function TabIcon({ symbol, color }: { symbol: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{symbol}</Text>;
}

export default function TabsLayout() {
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
        tabBarInactiveTintColor: colors.offline,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Map',
          tabBarIcon: ({ color }) => <TabIcon symbol="📍" color={color} />,
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: 'Work',
          // Only for people who belong to an organization.
          href: hasActiveOrg ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon symbol="🦺" color={color} />,
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: 'Members',
          tabBarIcon: ({ color }) => <TabIcon symbol="👥" color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <TabIcon symbol="💬" color={color} />,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabIcon symbol="⚙️" color={color} />,
        }}
      />
    </Tabs>
  );
}
