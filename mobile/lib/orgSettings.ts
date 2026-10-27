// Matches delete_organization()'s check (migration ...000067): the typed name
// must be the organization's name, ignoring case and surrounding spaces.
export function confirmsName(typed: string, orgName: string): boolean {
  return typed.trim().toLowerCase() === orgName.trim().toLowerCase() && typed.trim() !== '';
}

// What deleting removes, said plainly before anyone types the name.
export const DELETE_EFFECTS: string[] = [
  'Everyone is removed, and anyone clocked in is clocked out.',
  'All shifts, timesheets, teams and the record of who looked at whom are deleted.',
  'Everyone in it gets a notification that it closed and that nobody there can see them any more.',
  'Nobody’s circles or own location history are touched.',
];
