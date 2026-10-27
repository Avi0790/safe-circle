import React from 'react';
import { Alert, TextInput } from 'react-native';
import { act } from 'react-test-renderer';
import { fake } from '../../test-support/fakeSupabase';
import { allText, pressables, press, render, tapAlertButton, unmountAll } from '../../test-support/render';

// The Job sites screen: owners and admins add (here, or by address) and
// remove sites; managers only look. Server, GPS and address search are faked.
const mockRole: { current: string } = { current: 'owner' };
const mockSearch = jest.fn(async (_q: string) => [
  { id: 'p1', title: 'Walmart Supercenter', subtitle: '1815 E Highland Dr', latitude: 35.82, longitude: -90.66 },
]);
jest.mock('@/lib/supabase', () => require('../../test-support/fakeSupabase'));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({ orgId: 'o1' }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('@/contexts/AccountContext', () => ({
  useAccount: () => ({ orgs: [{ org_id: 'o1', name: 'Riverside', role: mockRole.current }] }),
}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
  getCurrentPositionAsync: async () => ({ coords: { latitude: 35.84, longitude: -90.7 } }),
}));
jest.mock('@/lib/geocode', () => ({ MIN_QUERY_LENGTH: 3, searchPlaces: (q: string) => mockSearch(q) }));
jest.mock('@/lib/jobSiteReminders', () => ({ MAX_REGIONS: 20 }));

import JobSitesScreen from '../../app/(app)/job-sites';

const field = (r: Awaited<ReturnType<typeof render>>, placeholder: string) =>
  r.root.findAll((n) => n.type === TextInput && n.props.placeholder === placeholder)[0];

beforeEach(() => {
  fake.reset();
  mockRole.current = 'owner';
  mockSearch.mockClear();
  fake.rpcResults.org_job_sites = { data: [{ id: 's1', name: 'Main St yard', latitude: 35.84, longitude: -90.7, radius_m: 150 }] };
});
afterEach(unmountAll);

describe('Job sites screen', () => {
  it('lists the sites and says workers are reminded by their own phone, privately', async () => {
    const r = await render(<JobSitesScreen />);
    const t = allText(r);
    expect(t).toContain('Main St yard');
    expect(t).toContain('150 m radius');
    expect(t).toContain('Sites (1 of 20)');
    expect(t).toContain('nobody here is told they were there');
    expect(fake.rpcsOf('org_job_sites')).toEqual([{ p_org: 'o1' }]);
  });

  it('adds a site where you are, with the chosen radius', async () => {
    const r = await render(<JobSitesScreen />);
    await act(async () => field(r, 'Main St yard').props.onChangeText('North gate'));
    await press(r, '300 m');
    await press(r, 'Add where I am now');
    expect(fake.rpcsOf('add_job_site')).toEqual([
      { p_org: 'o1', p_name: 'North gate', p_latitude: 35.84, p_longitude: -90.7, p_radius_m: 300 },
    ]);
  });

  it('needs a name to add where you are', async () => {
    const r = await render(<JobSitesScreen />);
    await press(r, 'Add where I am now');
    expect(allText(r)).toContain('Give the job site a name.');
    expect(fake.rpcsOf('add_job_site')).toHaveLength(0);
  });

  it('adds by address, named after the place if you left the name empty', async () => {
    const r = await render(<JobSitesScreen />);
    await act(async () => field(r, '1815 E Highland Dr, Jonesboro').props.onChangeText('walmart jonesboro'));
    await press(r, 'Search');
    expect(mockSearch).toHaveBeenCalledWith('walmart jonesboro');
    await press(r, 'Add Walmart Supercenter');
    expect(fake.rpcsOf('add_job_site')[0]).toMatchObject({ p_name: 'Walmart Supercenter', p_latitude: 35.82, p_longitude: -90.66, p_radius_m: 150 });
  });

  it('removes a site after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await render(<JobSitesScreen />);
    await press(r, 'Remove');
    await tapAlertButton(alert, 'Remove');
    expect(fake.rpcsOf('delete_job_site')).toEqual([{ p_site: 's1' }]);
    alert.mockRestore();
  });

  it('shows the server refusing', async () => {
    fake.rpcResults.add_job_site = { error: { message: 'An organization can have up to 20 job sites.' } };
    const r = await render(<JobSitesScreen />);
    await act(async () => field(r, 'Main St yard').props.onChangeText('One more'));
    await press(r, 'Add where I am now');
    expect(allText(r)).toContain('up to 20 job sites');
  });

  it('a manager sees the sites but cannot change them', async () => {
    mockRole.current = 'manager';
    const r = await render(<JobSitesScreen />);
    expect(allText(r)).toContain('Main St yard');
    expect(pressables(r, 'Remove')).toHaveLength(0);
    expect(allText(r)).not.toContain('Add a site');
  });
});
