import React from 'react';
import { Alert } from 'react-native';
import { act, create } from 'react-test-renderer';

const mockRpc = jest.fn(async () => ({ data: null, error: null }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => (mockRpc as any)(...a) } }));
jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  return { Marker: (p: any) => <View {...p} /> };
});

import { RoadReportMarker } from '../RoadReportMarker';
import type { RoadReport } from '@/lib/roadReports';

const report = (over: Partial<RoadReport> = {}): RoadReport => ({
  id: 'rep-1', reporter_id: 'sam', kind: 'hazard', latitude: 35.1, longitude: -90.2,
  created_at: new Date(Date.now() - 5 * 60_000).toISOString(), expires_at: new Date(Date.now() + 55 * 60_000).toISOString(),
  profiles: { full_name: 'Sam' }, ...over,
});

async function tap(r: RoadReport, onChanged = jest.fn()) {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<RoadReportMarker report={r} myUserId="me" onChanged={onChanged} />);
  });
  const marker = tree.root.findAll((n) => typeof n.props.onPress === 'function')[0];
  expect(marker.props.coordinate).toEqual({ latitude: 35.1, longitude: -90.2 });
  await act(async () => marker.props.onPress());
  return tree;
}

describe('RoadReportMarker', () => {
  beforeEach(() => mockRpc.mockClear());

  it("tells you who reported what, and offers nothing to change on someone else's report", async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await tap(report());
    const [title, body, buttons] = alert.mock.calls[0] as [string, string, { text: string }[]];
    expect(title).toBe('⚠️ Hazard reported');
    expect(body).toMatch(/^By Sam · 5m ago · clears in 5[45] min$/);
    expect(buttons.map((b) => b.text)).toEqual(['OK']);
    alert.mockRestore();
  });

  it('lets you take back your own report', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onChanged = jest.fn();
    await tap(report({ reporter_id: 'me' }), onChanged);
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => Promise<void> }[];
    const takeBack = buttons.find((b) => b.text === 'Take back report')!;
    await act(async () => {
      await takeBack.onPress!();
    });
    expect(mockRpc).toHaveBeenCalledWith('clear_road_report', { p_id: 'rep-1' });
    expect(onChanged).toHaveBeenCalled();
    alert.mockRestore();
  });
});
