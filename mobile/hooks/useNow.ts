import { useEffect, useState } from 'react';

// Re-renders on an interval so "due in 12 min" style labels stay current
// without every component running its own timer.
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
