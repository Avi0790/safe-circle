import type { CrewMapMarker, CrewMapPoint } from './CrewMap';

// react-native-maps has no web renderer (see the Map tab's index.web.tsx);
// the crew list below carries the same information.
export function CrewMap(_props: { markers?: CrewMapMarker[]; path?: CrewMapPoint[] }) {
  return null;
}
