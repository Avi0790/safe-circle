// Filing an incident report (lib/incidents.ts) against a stand-in server.
const mockUploads: { bucket: string; path: string }[] = [];
const mockRemoved: string[] = [];
const mockRpc = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          mockUploads.push({ bucket, path });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          mockRemoved.push(...paths);
          return { error: null };
        },
      }),
    },
  },
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: () => {},
      renderAsync: async () => ({ saveAsync: async () => ({ base64: 'AAAA' }) }),
    }),
  },
}));
jest.mock('expo-image-picker', () => ({}));

import { incidentPhotoPath, submitIncident } from '@/lib/incidents';

const ORG = '11111111-1111-1111-1111-111111111111';
const ME = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  mockUploads.length = 0;
  mockRemoved.length = 0;
  mockRpc.mockReset();
});

describe('incident reports', () => {
  it('needs a note', async () => {
    expect(await submitIncident({ orgId: ORG, userId: ME, kind: 'hazard', note: '   ' })).toEqual({ ok: false, error: 'Say what happened.' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('sends the report with the position it was given', async () => {
    mockRpc.mockResolvedValue({ data: 'r1', error: null });
    const result = await submitIncident({
      orgId: ORG, userId: ME, kind: 'injury', note: '  Cut hand on sheet metal ', position: { latitude: 35.8, longitude: -90.7 },
    });
    expect(result).toEqual({ ok: true, id: 'r1' });
    expect(mockRpc).toHaveBeenCalledWith('report_incident', {
      p_org: ORG, p_kind: 'injury', p_note: 'Cut hand on sheet metal', p_latitude: 35.8, p_longitude: -90.7, p_photo_path: null,
    });
  });

  it('uploads the photo into the reporter\'s own folder for that organization', async () => {
    mockRpc.mockResolvedValue({ data: 'r2', error: null });
    await submitIncident({ orgId: ORG, userId: ME, kind: 'hazard', note: 'Loose rail', photoUri: 'file:///photo.jpg' });
    expect(mockUploads).toHaveLength(1);
    expect(mockUploads[0].bucket).toBe('incident-photos');
    expect(mockUploads[0].path).toMatch(new RegExp(`^${ORG}/${ME}/\\d+\\.jpg$`));
    expect(mockRpc.mock.calls[0][1].p_photo_path).toBe(mockUploads[0].path);
  });

  it('removes the uploaded photo if the report itself is refused', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "You're not in this organization." } });
    const result = await submitIncident({ orgId: ORG, userId: ME, kind: 'hazard', note: 'x', photoUri: 'file:///p.jpg' });
    expect(result).toEqual({ ok: false, error: "You're not in this organization." });
    expect(mockRemoved).toEqual([mockUploads[0].path]);
  });

  it('builds the storage path the server expects', () => {
    expect(incidentPhotoPath(ORG, ME, 1700000000000)).toBe(`${ORG}/${ME}/1700000000000.jpg`);
  });
});
