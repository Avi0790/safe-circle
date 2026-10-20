import { useEffect, useRef } from 'react';
import { CarPlay } from '@/modules/safecircle-carplay';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { useCircleMembersContext } from '@/contexts/CircleMembersContext';
import { useNow } from '@/hooks/useNow';
import { carPlayState, runCarPlayAction } from '@/lib/carplay';

// Keeps the CarPlay screen (modules/safecircle-carplay) in step with the app:
// sends the circle whenever it changes, and carries out the actions tapped on
// the car screen, answering with a short message there. Renders nothing, and
// does nothing where there's no CarPlay module (Expo Go, Android, tests).
export function CarPlayBridge({ carplay = CarPlay }: { carplay?: typeof CarPlay }) {
  const { session } = useAuth();
  const { selectedCircle } = useCircles();
  const { members } = useCircleMembersContext();
  // "Updated 2m ago" keeps moving even when nothing else changes.
  const now = useNow(60_000);
  const circleId = useRef<string | null>(null);
  circleId.current = selectedCircle?.id ?? null;

  useEffect(() => {
    if (!carplay) return;
    carplay.setState(
      carPlayState({
        signedIn: !!session,
        circleName: selectedCircle?.name ?? null,
        members,
        myUserId: session?.user.id,
        now,
      }),
    );
  }, [carplay, session, selectedCircle?.name, members, now]);

  useEffect(() => {
    if (!carplay) return;
    const sub = carplay.addListener('onAction', async ({ id }) => {
      const message = await runCarPlayAction(id, circleId.current);
      carplay.showMessage(message);
    });
    return () => sub.remove();
  }, [carplay]);

  return null;
}
