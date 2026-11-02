import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useAccount } from '@/contexts/AccountContext';
import { routeForNotification } from '@/lib/notificationRoute';

// Opens the screen a tapped notification is about (lib/notificationRoute.ts),
// whether the tap started the app or brought it back. Draws nothing.
export function NotificationRouter() {
  const router = useRouter();
  const { orgs } = useAccount();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const route = routeForNotification(
      response.notification.request.content.data as Record<string, unknown>,
      (orgId) => orgs.find((o) => o.org_id === orgId)?.name,
    );
    if (route) router.push(route as never);
  }, [response, orgs, router]);

  return null;
}
