import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { getAvatarColor, getInitials, isSafeAvatarUrl } from '@/lib/avatar';

// Profile photo when there is one, colored initials otherwise (and if the
// photo fails to load). `onSettled` fires once whatever is going to be drawn
// is on screen — immediately for initials, after load/error for a photo —
// which the map uses to know when a marker's bitmap can be frozen.
export function Avatar({
  id,
  name,
  url,
  size = 36,
  onSettled,
}: {
  id: string;
  name: string;
  url?: string | null;
  size?: number;
  onSettled?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const photo = isSafeAvatarUrl(url) && !failed ? url : null;

  // A new photo deserves a fresh attempt even if the last one errored.
  useEffect(() => setFailed(false), [url]);

  useEffect(() => {
    if (!photo) onSettled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo]);

  const dimensions = { width: size, height: size, borderRadius: size / 2 };

  if (photo) {
    return (
      <Image
        source={{ uri: photo }}
        style={[dimensions, { backgroundColor: getAvatarColor(id) }]}
        onLoad={onSettled}
        onError={() => setFailed(true)}
        accessibilityLabel={`${name}'s photo`}
      />
    );
  }

  return (
    <View style={[styles.circle, dimensions, { backgroundColor: getAvatarColor(id) }]}>
      <Text style={[styles.text, { fontSize: size * 0.4 }]}>{getInitials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontWeight: '700' },
});
