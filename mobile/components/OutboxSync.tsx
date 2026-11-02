import { useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { announce } from '@/lib/announce';
import { t } from '@/lib/i18n';
import { flushOutbox } from '@/lib/outbox';

// Sends whatever was saved without signal (lib/outbox.ts): when the app
// opens, when it comes back to the front, and the moment the connection
// returns. Draws nothing.
export function OutboxSync() {
  useEffect(() => {
    let alive = true;
    const flush = async () => {
      const { sent } = await flushOutbox();
      if (alive && sent > 0) {
        announce(t(sent === 1 ? 'Sent 1 item that was waiting for signal' : 'Sent {n} items that were waiting for signal', { n: sent }));
      }
    };
    flush();
    const net = NetInfo.addEventListener((state) => {
      if (state.isConnected) flush();
    });
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') flush();
    });
    return () => {
      alive = false;
      net();
      app.remove();
    };
  }, []);
  return null;
}
