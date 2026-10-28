import { useEffect } from 'react';
import { Text, type TextStyle } from 'react-native';
import { announce } from '@/lib/announce';

// An error under a form or button. Read out as soon as it appears, so a
// VoiceOver user isn't left wondering why nothing happened.
export function ErrorText({ children, style }: { children: string | null | undefined; style?: TextStyle }) {
  useEffect(() => {
    announce(children);
  }, [children]);
  if (!children) return null;
  return (
    <Text style={style} accessibilityRole="alert" accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}
