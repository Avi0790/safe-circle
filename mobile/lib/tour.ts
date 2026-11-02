import AsyncStorage from '@react-native-async-storage/async-storage';

// The short welcome tour (components/WelcomeTour.tsx): shown once, the first
// time someone opens the app signed in, and again from Settings.

const SEEN_KEY = 'safecircle.tour.seen.v1';

export interface TourPage {
  emoji: string;
  title: string;
  body: string;
}

export const TOUR_PAGES: TourPage[] = [
  {
    emoji: '🛡️',
    title: 'Welcome to Safe Circle',
    body: 'Share where you are only with the people you choose, and only for as long as you choose.',
  },
  {
    emoji: '🆘',
    title: 'Help, fast',
    body: 'One tap on SOS alerts your circle with your location. "Walk me home" and "Check on me" send it for you if you don\'t arrive or check in.',
  },
  {
    emoji: '👷',
    title: 'At work, only on shift',
    body: 'Join your work crew and your managers see you only while you\'re clocked in. Every time one looks, you see it in your Work tab.',
  },
  {
    emoji: '🔒',
    title: "You're in control",
    body: 'Hide from one person with ghost mode, choose how long history is kept, and download or delete everything from Settings.',
  },
];

export async function tourSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SEEN_KEY)) === '1';
  } catch {
    return true; // never trap someone in the tour over a storage error
  }
}

export async function markTourSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_KEY, '1');
  } catch {
    // shown again next time, at worst
  }
}

// "Show the tour again" in Settings.
const listeners = new Set<() => void>();
export function showTourAgain() {
  listeners.forEach((l) => l());
}
export function onShowTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
