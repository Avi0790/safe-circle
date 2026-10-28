import { AccessibilityInfo } from 'react-native';

// Say something out loud to VoiceOver (or TalkBack) users: things that
// change on screen without them moving there, like "SOS sent" or an error
// appearing under a form. Does nothing when no screen reader is on.
export function announce(message: string | null | undefined): void {
  if (!message) return;
  try {
    AccessibilityInfo.announceForAccessibility(message);
  } catch {
    // nothing to tell
  }
}
