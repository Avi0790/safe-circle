// The privacy policy for the web dashboard's /privacy page
// (components/PrivacyPolicy.tsx). A copy of mobile/lib/privacyPolicy.ts from
// its first export on, which is the original: change it there, then copy it
// here (src/lib/__tests__/privacyPolicy.test.ts fails while they differ).

export const POLICY_UPDATED = '2026-10-30';

export const POLICY_FILL = { contact: 'surendrasunar507@gmail.com', age: '13' };

export const POLICY: { title: string; items: string[] }[] = [
  {
    title: 'The short version',
    items: [
      'Your location is shared only with people you choose, and only while you share it.',
      'At work, your employer sees you only while you are clocked in, and you can see every time they look.',
      'We don’t sell your data, show ads, or use tracking or analytics tools.',
      'You can download everything we hold about you, or delete your account, at any time.',
    ],
  },
  {
    title: 'What we collect',
    items: [
      'Your account: name, email address and password (stored only as a secure hash by our sign-in provider), and a profile photo if you add one.',
      'Your location while you share it: position, accuracy, speed, battery level and the time.',
      'What you add to a circle: messages, places, pins, trips, check-ins, curfews, walk and check-on-me timers.',
      'Only if you add them: a phone number (for Text for help), a medical card, backup contacts.',
      'At work: when you clock in and out, check-ins, your position while on shift, and a record of who looked at it.',
      'The token your phone needs to receive notifications, and the language you use the app in.',
      'Motion sensor readings, for shake-to-SOS and fall detection, stay on your phone; only an SOS is ever sent.',
    ],
  },
  {
    title: 'Who can see it',
    items: [
      'People in your circles see your location while you share it. Ghost mode hides you from specific people, and sharing can end by itself after a time you pick.',
      'Your medical card is shown to your circle only while you have an active SOS.',
      'At work, owners and admins, and the managers of teams you’re on, see you only while you’re clocked in. Other workers never see you.',
      'Every time a manager or admin looks at your location, it is recorded and shown to you in the Work tab.',
      'After you leave an organization, its owners and admins can still see when you worked there, never where you were, for up to 90 days, for payroll.',
      'A guest link shows your first name and location, or your trip’s ETA, to anyone who has it, until it expires or you revoke it.',
      'Whoever runs Safe Circle sees only totals (how many accounts and organizations), never anyone’s name, location or messages.',
    ],
  },
  {
    title: 'Services we use',
    items: [
      'Supabase stores the data and handles sign-in.',
      'Expo, Apple and Google deliver notifications; they see the notification’s text.',
      'When you use Directions or search for a place, the place you search for or your position goes to OpenStreetMap-based services (OSRM, OpenStreetMap Germany, Photon by Komoot, Nominatim) to find routes, places, stops and speed limits.',
      'Open-Meteo receives a position to show the weather there.',
      'Maps are drawn by Apple Maps on iPhone, Google Maps on Android, and OpenStreetMap and Esri map images on the web.',
      'Text for help puts a Google Maps link to your position in the text message you send.',
      'Organizations that pay by card do so on Stripe’s pages; card details never reach Safe Circle.',
      'In-app Help works on the phone itself; your questions aren’t sent anywhere.',
    ],
  },
  {
    title: 'How long we keep it',
    items: [
      'Location history: you choose 1 day, 7 days, 30 days or forever (Settings → Location history). Older positions are deleted every night; your latest one is kept so your circle’s map still works.',
      'Road reports expire after 1 to 3 hours and are deleted after a day. Pins and guest links expire on their own.',
      'Everything else stays until you delete it or delete your account.',
    ],
  },
  {
    title: 'Your choices',
    items: [
      'Stop sharing at any time, share for a set time, or hide from specific people.',
      'Download all your data: Settings → Your data → Download my data.',
      'Delete your account: everything you created is deleted. A circle you created that still has other people in it is handed to its longest-standing member.',
      'Leave an organization at any time; it stops seeing you at once.',
      'Lock the app with Face ID, your fingerprint or your passcode.',
    ],
  },
  {
    title: 'How it’s protected',
    items: [
      'The database itself decides who can read what (row-level security on every table), so the rules hold even outside the app.',
      'Everything travels encrypted (HTTPS).',
      'Automatic tests check these privacy rules on every change to the code.',
    ],
  },
  {
    title: 'Children',
    items: ['Safe Circle is meant for people aged {age} and older.'],
  },
  {
    title: 'Changes and contact',
    items: [
      'If this policy changes, the date above changes. If what an employer can see changes, workers are asked to accept it again before they can clock in.',
      'Questions or requests: {contact}.',
      'Safe Circle is a student capstone project. This page describes how the software works; it isn’t legal advice.',
    ],
  },
];
