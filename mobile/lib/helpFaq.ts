// A free, offline "help" assistant: no API key, no account, no per-message
// cost, no network call at all — just keyword-matching against a built-in
// list of answers about how Safe Circle works. This replaced an
// Anthropic-backed version (still in backend/supabase/functions/send-ai-help,
// unused by the client for now) once it became clear a real LLM API isn't
// worth a recurring real-money cost for a capstone demo someone could
// forget to keep funded. Every other "smart" feature in this app already
// follows this same free-service preference (OpenStreetMap, Esri, Open-Meteo).
export interface FaqEntry {
  id: string;
  // Lowercase words/phrases to match against the question. Multi-word
  // phrases score higher than single words, so "walk me home" beats a
  // stray match on "home" alone.
  keywords: string[];
  // The canonical phrasing — shown as a tappable starter chip.
  question: string;
  answer: string;
}

export const HELP_FAQ: FaqEntry[] = [
  {
    id: 'ghost-mode',
    keywords: ['ghost mode', 'hide my location', 'hide from'],
    question: 'What does Ghost Mode do?',
    answer:
      "Ghost Mode hides your location from one specific person while everyone else in your circles still sees you normally. Turn it on in Settings → Privacy → Ghost mode. The other person's map just shows your dot missing, the same as any ordinary sharing gap.",
  },
  {
    id: 'walk-me-home',
    keywords: ['walk me home', 'walk home', 'walking home'],
    question: 'How does Walk me home work?',
    answer:
      "Pick a saved place and how long you expect to take (Map tab → ⋯ Quick actions → Walk me home). Your circle is told when you arrive. If you don't arrive — or tap \"I'm safe\" — before the timer runs out, an SOS goes out automatically with your last known location.",
  },
  {
    id: 'check-on-me',
    keywords: ['check on me', 'safety timer', 'checkin timer'],
    question: 'What is Check on me?',
    answer:
      "It's Walk me home's sibling for when there's no destination — studying alone, a first date, a solo hike. Set a timer and an optional note; if you don't tap \"I'm safe\" in time, an SOS goes out automatically with your last known location.",
  },
  {
    id: 'need-a-ride',
    keywords: ['need a ride', 'ride request', 'request a ride'],
    question: 'How does Need a ride work?',
    answer:
      "Tap 🚗 Need a ride (Map tab → ⋯ Quick actions). It alerts only the circle-mates who are currently driving near you. If nobody qualifies, it offers to ask everyone in the circle instead. First person to tap \"I'll go\" gets the pickup.",
  },
  {
    id: 'sos',
    keywords: ['sos', 'emergency button', 'send sos'],
    question: 'How does the SOS button work?',
    answer:
      "Tap the red SOS button on the Map tab, then confirm. It shares your current location with everyone in your circle and offers a one-tap \"Call 911\" too. Circle-mates can tap \"I'm on my way\" so you know you've been seen — if nobody does within a few minutes, the whole circle is alerted again.",
  },
  {
    id: 'medical-card',
    keywords: ['medical card', 'blood type', 'allergies'],
    question: "What's the medical card for?",
    answer:
      "Settings → Medical card lets you add blood type, allergies, conditions, medications, and a note. It's only ever visible to your circle while you have an active SOS — never otherwise.",
  },
  {
    id: 'guest-link',
    keywords: ['guest link', 'guest tracking', 'share without the app', "doesn't have the app"],
    question: "How do I share my location with someone who doesn't have the app?",
    answer:
      'Settings → Guest tracking link. Create a link that lasts 1, 4, or 24 hours and share it — anyone opening it sees your live location and first name in any browser, no account needed. Revoke it any time, and you can see how many times it was opened.',
  },
  {
    id: 'text-for-help',
    keywords: ['text for help', 'no internet', 'text message help'],
    question: 'What does Text for help do?',
    answer:
      "A fallback for when there's no internet — every other alert here needs it. Map tab → ⋯ Quick actions → Text for help opens a text message with your location, pre-filled to circle-mates or backup contacts who've added a phone number. You still have to tap send yourself.",
  },
  {
    id: 'backup-contacts',
    keywords: ['backup contact', 'contact outside'],
    question: 'What are backup contacts?',
    answer:
      "People outside your circle — a neighbor, a relative — you can text for help in an emergency. Add them in Settings → Backup contacts. They never see your live location, only whatever you choose to text them.",
  },
  {
    id: 'quick-status',
    keywords: ['quick status', 'status chip', 'on my way studying'],
    question: 'What is quick status?',
    answer:
      'A short chip like "🚗 On my way" or "📚 Studying" next to your name and pin, set in Settings → Quick status. It clears itself after a few hours, or tap the same chip again to clear it early.',
  },
  {
    id: 'auto-status',
    keywords: ['auto status', 'status from places', 'arriving home status', 'status change automatically', 'automatic status'],
    question: 'Does my status change automatically?',
    answer:
      'Yes — arriving at a saved place sets your status on its own, like "🏠 Home" or "📚 In class," and clears it when you leave. It never overwrites a status you set yourself.',
  },
  {
    id: 'meetup-pins',
    keywords: ['meetup pin', 'drop a pin', 'meet here'],
    question: 'What is Drop a pin?',
    answer:
      'Map tab → ⋯ Quick actions → Drop a pin marks a spot for your whole circle — a festival, a trailhead, "meet here." It pushes to everyone and disappears on its own after the time you choose.',
  },
  {
    id: 'satellite-map',
    keywords: ['satellite map', 'satellite view', 'map type'],
    question: 'How do I switch to satellite view?',
    answer:
      'On the Map tab, tap the 🛰️/🗺️ button in the top-right corner to toggle between the standard map and satellite imagery.',
  },
  {
    id: 'app-lock',
    keywords: ['app lock', 'face id', 'passcode lock', 'lock the app', 'lock safe circle'],
    question: 'How do I lock the app?',
    answer:
      "Settings → Lock the app turns on Face ID, fingerprint, or passcode protection, so a borrowed or stolen unlocked phone can't be used to see your family's locations. It checks that unlocking actually works before turning on.",
  },
  {
    id: 'delete-account',
    keywords: ['delete my account', 'delete account'],
    question: 'How do I delete my account?',
    answer:
      "Settings → Your data → Delete my account, then type DELETE to confirm. It's permanent. If you created a circle that still has other people in it, ownership is handed to another member automatically rather than deleting the circle for everyone.",
  },
  {
    id: 'download-data',
    keywords: ['download my data', 'export my data', 'download data'],
    question: 'How do I download my data?',
    answer:
      'Settings → Your data → Download my data. It writes everything Safe Circle holds about you to a real file you can save through the share sheet — your profile, locations, messages, and more.',
  },
  {
    id: 'who-checked',
    keywords: ["who's checked", 'checked on my location', 'viewed my location'],
    question: "How do I see who's checked on my location?",
    answer:
      "Settings → Privacy → Who's checked on me shows a log of when a circle-mate opened your location history — not every glance at the live map, just when someone specifically looked you up.",
  },
  {
    id: 'auto-delete-history',
    keywords: ['auto-delete history', 'delete my history', 'location history retention', 'auto-delete', 'delete my location history'],
    question: 'Can I auto-delete my location history?',
    answer:
      'Yes — Settings → Privacy → Location history lets you pick 1, 7, or 30 days, or forever. A daily job actually deletes the old rows; your current location is never affected by this setting.',
  },
  {
    id: 'join-approval',
    keywords: ['join approval', 'approve new members', 'require approval'],
    question: 'How do I require approval before people join my circle?',
    answer:
      "Settings → Join approvals lets a circle's creator require their OK before anyone new joins — so a leaked invite code only ever creates a request you can approve or deny.",
  },
  {
    id: 'shake-sos',
    keywords: ['shake for sos', 'shake phone sos'],
    question: 'How does shake for SOS work?',
    answer:
      "Turn it on in Settings → Shake for SOS. Shake your phone firmly a few times and it brings up the same SOS confirmation as the button — handy when your phone is in a pocket or bag.",
  },
  {
    id: 'temporary-sharing',
    keywords: ['temporary sharing', 'share for an hour', 'sharing window', 'limited time', 'share my location for'],
    question: 'Can I share my location for a limited time only?',
    answer:
      "Yes — Settings → Share my location lets you choose 1, 2, or 8 hours, or until you turn it off yourself. It stops automatically when the window ends, even if the app is force-quit.",
  },
  {
    id: 'nearby-alerts',
    keywords: ['nearby alert', 'someone is nearby', 'nearby notification'],
    question: 'What are nearby alerts?',
    answer:
      "Turn them on in Settings → Nearby alerts to get a push when a circle-mate comes close to you — roughly 500m on foot, farther when either of you is driving so the warning comes early.",
  },
  {
    id: 'multiple-circles',
    keywords: ['multiple circles', 'more than one circle', 'add another circle', 'second circle'],
    question: 'Can I be in more than one circle?',
    answer:
      "Yes — Settings → Add another circle lets you create or join a second circle (a different friend group, a study group, and so on) without leaving any circle you're already in.",
  },
  {
    id: 'chat-checkin',
    keywords: ['check in', 'chat message', 'checked in'],
    question: 'What does the 📍 Check in button do?',
    answer:
      "It's a chat message that also shares where you are, with a \"View on map\" link — a quick way to say \"here's where I am right now\" in the Chat tab.",
  },
  {
    id: 'weather',
    keywords: ['weather', 'temperature at their location'],
    question: "How do I see the weather where someone is?",
    answer:
      "Open a circle member's location history (tap them on the Members tab) — the current temperature and conditions at their last known spot are shown there.",
  },
  {
    id: 'places',
    keywords: ['places', 'geofence', 'arrive alert', 'leave alert'],
    question: 'How do arrive/leave alerts for places work?',
    answer:
      'Add a place in Settings → Manage places (like Home or School). Your circle is alerted when someone arrives at or leaves it, and the app shows who\'s "here now" at each place in real time.',
  },
  {
    id: 'transfer-ownership',
    keywords: ['transfer ownership', 'leave my own circle', 'make owner', 'leave a circle i created', 'leave the circle i created'],
    question: 'How do I leave a circle I created?',
    answer:
      "Circle creators can't leave directly, since it would orphan the circle — instead, use \"Make owner\" on the Members tab to hand it to someone else first. After that, you can leave like any other member.",
  },
  {
    id: 'battery',
    keywords: ['low battery alert', 'battery push', 'battery is low', 'low battery'],
    question: "What happens when someone's battery is low?",
    answer:
      "The circle gets a push the moment someone's phone first drops to 20% or below, so people know sharing might stop soon — not repeated on every low-battery ping after that.",
  },
  {
    id: 'directions',
    keywords: ['directions', 'navigate', 'navigation', 'turn by turn', 'speedometer', 'route to'],
    question: 'How do I get driving directions?',
    answer:
      "Open ⋯ Quick actions on the Map tab and tap Directions. Choose 🚗 Drive or 🚶 Walk at the top (it remembers your choice), then search for a place (or pick one you saved), check the route, and tap Start for turn-by-turn text and voice with a live speedometer. When driving you can't type a destination while the car is moving, so ask a passenger or pull over first; walking has no such lock, and gives short “In 200 ft, turn left” prompts and your pace instead of a speedometer. It works while the screen is open, and routes come from free OpenStreetMap-based services, so double-check them against road signs. On the route screen you can save the place as Home, Work or by its name; saved places stay on your phone only and appear first next time, with a Remove button. Before you start you can also choose to share the trip with your circle, so they see where you're headed and your ETA. Choose 🚌 Transit to get bus and train directions in your phone's Maps app instead (Safe Circle can't plan those itself). While navigating, lane arrows appear in the green card as you near a turn (where the map has lane data) and the voice says which lanes to use; the posted speed limit shows beside your speed where the map has one, and your speed turns red when you're over. The round buttons on the right switch heading-up/north-up, add a stop, mute, and show the whole route, and Report flags an incident. Tap the time and distance at the bottom, as in Apple Maps, for: Audio (All voice, Alerts only, No voice), Share ETA with your circle mid-drive (or stop sharing), Share ETA with anyone (even without Safe Circle: just your ETA as a message, or a live link that shows where you're headed, your ETA and your position until you arrive), Report an incident (crash, hazard, speed check, road closed: one tap, pinned where you are, seen by your circle for an hour and spoken to circle-mates driving towards it), Add a stop (gas, coffee, food, parking, pharmacy) along the road ahead, which reroutes you via it, Map mode (also from the map button on the Map tab: Explore, Driving with traffic, Satellite with or without labels, and 3D Flyover), and Driving avatar (also by tapping your car on the map): swipe through the navigation arrow, sports car, compact, classic, race car, sedan and off-road, pick one of eight colours, and tap Done.",
  },
  {
    id: 'share-trip',
    keywords: ['bus', 'train', 'flight', 'plane', 'fly', 'flying', 'transit', 'share trip', 'eta', 'landing'],
    question: "Can I let my circle know I'm on a bus, train or flight?",
    answer:
      "Yes: ⋯ Quick actions → Share a bus, train or flight (or the link on the Directions screen). Pick the kind of trip, type where you're going, and set when you expect to arrive. Your circle sees, for example, “✈️ Sam is flying to Denver, landing in about 2 h”, and gets a notification; they don't see a route. Because a phone on a plane can't send updates, the trip stays up until your arrival time plus a grace period for delays (30 minutes for a bus, 45 for a train, 2 hours for a flight), or until you tap I've arrived (which tells them) or Stop sharing (which doesn't). Running late moves the time 15 minutes later. Ghost mode and sharing windows apply as usual. Once it's up you can also Share ETA with anyone: a message with your arrival time, or a live link for people without Safe Circle that follows the trip — running late updates it, and arriving or stopping ends it, even if the app is closed.",
  },
  {
    id: 'privacy-overview',
    keywords: ['how is my privacy', 'is my location private', 'who can see my location', 'privacy'],
    question: 'How is my privacy protected?',
    answer:
      "Only people in a circle with you can see your location, and that's enforced by the database, not just the app. You can hide from specific people (Ghost mode), share for a limited time, require approval for new members, choose how long history is kept, and see who's checked on you. For the full tour, open Settings → Privacy → How your privacy works.",
  },
];

export const HELP_FALLBACK_ANSWER =
  "I don't have an answer for that one built in. Try asking about a specific feature — Ghost Mode, Walk me home, curfew, guest links, and so on — or check Settings for the full list of what's there.";

// Scores every entry by how many of its keywords appear in the question
// (a matched multi-word phrase counts more than a single word, so "walk me
// home" outscores a stray match on "home"), and returns the best match's
// answer, or null if nothing scored above zero.
export function findFaqAnswer(question: string): string | null {
  const q = question.toLowerCase();
  let bestEntry: FaqEntry | null = null;
  let bestScore = 0;

  for (const entry of HELP_FAQ) {
    let score = 0;
    for (const keyword of entry.keywords) {
      if (q.includes(keyword)) {
        score += keyword.split(' ').length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return bestEntry ? bestEntry.answer : null;
}
