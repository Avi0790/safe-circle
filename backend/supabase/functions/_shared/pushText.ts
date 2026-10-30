// Notifications in each recipient's language (migration ...000071). The
// database writes every alert in English, in a handful of fixed shapes
// ("⏰ Ana missed curfew"); each push Edge Function translates the English
// for its Spanish-speaking recipients just before delivery. Names, places and
// anything a person typed (a pin's label, an SOS message) are carried over
// as they are. A message that matches no rule is sent in English, never
// garbled: adding a new alert in SQL can't break delivery.
//
// No Deno or Node APIs here, so it runs in the Edge Functions and under
// `node --test` (pushText.test.ts) alike. Keep the Spanish in step with the
// app's (mobile/lib/translations/es.ts).

export type PushLanguage = "en" | "es";

type Rule = [RegExp, (...groups: string[]) => string];

const DURATION = (text: string) => text; // "25 min", "2 h", "1 h 30 min" read the same in Spanish

const TITLES: Rule[] = [
  [/^🚗 (.+) is on the way$/, (n) => `🚗 ${n} va en camino`],
  [/^👀 (.+) saw your SOS$/, (n) => `👀 ${n} vio tu SOS`],
  [/^📵 (.+) has gone quiet$/, (n) => `📵 ${n} no da señales`],
  [/^⏰ (.+) missed curfew$/, (n) => `⏰ ${n} no llegó a la hora`],
  [/^✅ (.+) arrived safely$/, (n) => `✅ ${n} llegó bien`],
  [/^✅ You're in: (.+)$/, (c) => `✅ Ya estás en: ${c}`],
  [/^Request declined: (.+)$/, (c) => `Solicitud rechazada: ${c}`],
  [/^👑 You're now the owner of (.+)$/, (c) => `👑 Ahora eres el propietario de ${c}`],
  [/^(\S+) (.+) dropped a pin$/, (emoji, n) => `${emoji} ${n} marcó un punto`],
  [/^✅ (.+) checked in$/, (n) => `✅ ${n} se reportó`],
  [/^✅ (.+) arrived$/, (n) => `✅ ${n} llegó`],
  [/^✅ (.+) is safe$/, (n) => `✅ ${n} está a salvo`],
  [/^⏱️ Missed check-in$/, () => "⏱️ Reporte no realizado"],
  [/^🆘 Still no one has responded$/, () => "🆘 Todavía nadie ha respondido"],
  [/^⏰ Your check-on-me timer ran out$/, () => '⏰ Se acabó tu temporizador de "Revisa que esté bien"'],
  [/^⏰ Your walk timer ran out$/, () => "⏰ Se acabó el tiempo de tu caminata"],
  [/^👋 (.+) wants to join (.+)$/, (n, c) => `👋 ${n} quiere unirse a ${c}`],
  [/^🆘 SOS: (.+) needs help$/, (n) => `🆘 SOS: ${n} necesita ayuda`],
  [/^🚗 (.+) needs a ride$/, (n) => `🚗 ${n} necesita que lo lleven`],
  [/^⏱️ (.+) asked to be checked on$/, (n) => `⏱️ ${n} pidió que lo revisen`],
  [/^🚶 (.+) is walking to (.+)$/, (n, p) => `🚶 ${n} está caminando a ${p}`],
  [/^🚶 (.+) is walking$/, (n) => `🚶 ${n} está caminando`],
  [/^🚌 (.+) is on the bus$/, (n) => `🚌 ${n} va en autobús`],
  [/^🚆 (.+) is on the train$/, (n) => `🚆 ${n} va en tren`],
  [/^✈️ (.+) is flying$/, (n) => `✈️ ${n} está volando`],
  [/^(.+) closed$/, (o) => `${o} cerró`], // last: the most general shape
];

const BODIES: Rule[] = [
  [/^They accepted your ride request\.$/, () => "Aceptó tu solicitud de viaje."],
  [/^They know and are responding\.$/, () => "Ya lo sabe y está respondiendo."],
  [
    /^(.+) hasn't sent a location for (\d+) minutes while clocked in( \(since they clocked in\))?\. Their phone may be off or out of signal\.$/,
    (n, mins, since) =>
      `${n} no ha enviado su ubicación en ${mins} minutos estando en turno${since ? " (desde que marcó entrada)" : ""}. Puede que su teléfono esté apagado o sin señal.`,
  ],
  [/^Not at (.+) by (.+) yet\.$/, (p, t) => `Aún no está en ${p} a las ${t}.`],
  [/^Made it to (.+)\.$/, (p) => `Llegó a ${p}.`],
  [/^Open Safe Circle to see your circle\.$/, () => "Abre Safe Circle para ver tu círculo."],
  [/^The creator didn't approve your request\.$/, () => "Quien creó el círculo no aprobó tu solicitud."],
  [
    /^The previous owner deleted their account, so the circle is yours\.$/,
    () => "El propietario anterior eliminó su cuenta, así que el círculo ahora es tuyo.",
  ],
  [
    /^(.+) was deleted by its owner\. Nobody there can see you any more; your circles are unchanged\.$/,
    (o) => `Su propietario eliminó ${o}. Ya nadie allí puede verte; tus círculos no cambian.`,
  ],
  [/^They're safe\.$/, () => "Está a salvo."],
  [/^They got to (.+)\.$/, (p) => `Llegó a ${p}.`],
  [/^They ended their walk to (.+)\.$/, (p) => `Terminó su caminata a ${p}.`],
  [
    /^(.+) missed a scheduled check-in( and there is no location to show)?\.$/,
    (n, noLoc) => `${n} no hizo un reporte programado${noLoc ? " y no hay ubicación para mostrar" : ""}.`,
  ],
  [/^(.+)'s SOS from (.+) needs someone to check it\.$/, (n, t) => `El SOS de ${n} de las ${t} necesita que alguien lo revise.`],
  [
    /^Your circle was alerted\. Open Safe Circle and tap "I'm safe" if you're okay\.$/,
    () => 'Se avisó a tu círculo. Abre Safe Circle y toca "Estoy a salvo" si estás bien.',
  ],
  [/^Open Safe Circle → Settings to approve or deny\.$/, () => "Abre Safe Circle → Ajustes para aprobar o rechazar."],
  [
    /^(.+) sent an SOS while clocked in(?: at (.+))?\. Open Safe Circle to see where\.$/,
    (n, org) => `${n} envió un SOS estando en turno${org ? ` en ${org}` : ""}. Abre Safe Circle para ver dónde.`,
  ],
  [/^About ([\d.]+) mi from you\. Open Safe Circle to help\.$/, (d) => `A unas ${d} mi de ti. Abre Safe Circle para ayudar.`],
  [/^Open Safe Circle to help\.$/, () => "Abre Safe Circle para ayudar."],
  [/^They're OK\.$/, () => "Está bien."],
  [/^(.+) — due in (\d+) min\.$/, (note, m) => `${note === "No note" ? "Sin nota" : note} — vence en ${m} min.`],
  [
    /^(Heading|Walking|Flying) to (.+), (arriving|landing) in about (.+)\.$/,
    (verb, dest, end, dur) =>
      `${{ Heading: "Va a", Walking: "Camina a", Flying: "Vuela a" }[verb]} ${dest}; ${end === "landing" ? "aterriza" : "llega"} en unos ${DURATION(dur)}.`,
  ],
  [
    /^Due within (\d+) min\. You'll be alerted if they don't arrive\.$/,
    (m) => `Debe llegar en ${m} min. Se te avisará si no llega.`,
  ],
  [
    /^(.+) made you the creator\. You can rename it, remove members and manage join approvals\.$/,
    (n) => `${n} te hizo creador. Puedes renombrarlo, quitar miembros y administrar las aprobaciones.`,
  ],
];

function translate(text: string, rules: Rule[]): string {
  for (const [pattern, spanish] of rules) {
    const match = text.match(pattern);
    if (match) return spanish(...match.slice(1));
  }
  return text;
}

// An alert written by the database (send_alert_push), for one recipient. A
// pin's body is the label its dropper typed, so it's left alone.
export function localizePush(
  language: PushLanguage,
  title: string,
  body: string,
  type?: unknown,
): { title: string; body: string } {
  if (language !== "es") return { title, body };
  return { title: translate(title, TITLES), body: type === "pin" ? body : translate(body, BODIES) };
}

// The messages the Edge Functions write themselves, in either language.
// Anything a person typed (an SOS message) is quoted as it is.
export const PUSH = {
  lowBattery: (language: PushLanguage, name: string, percent: number) =>
    language === "es"
      ? { title: "🔋 Batería baja", body: `El teléfono de ${name} está al ${percent}%; puede dejar de compartir su ubicación pronto.` }
      : { title: "🔋 Low battery", body: `${name}'s phone is at ${percent}% — location sharing may stop soon.` },

  nearby: (language: PushLanguage, name: string, miles: number) => {
    const close = miles < 0.1;
    return language === "es"
      ? { title: "Cerca", body: `${name} está cerca — ${close ? "justo a tu lado" : `a ${miles.toFixed(1)} mi`}` }
      : { title: "Nearby", body: `${name} is nearby — ${close ? "right next to you" : `${miles.toFixed(1)} mi away`}` };
  },

  sos: (language: PushLanguage, name: string, message?: string | null) => {
    const quoted = message ? ` "${message}"` : "";
    return language === "es"
      ? { title: "🆘 SOS", body: `¡${name} necesita ayuda!${quoted}` }
      : { title: "🆘 SOS", body: `${name} needs help!${quoted}` };
  },

  place: (language: PushLanguage, name: string, arrived: boolean, place: string) =>
    language === "es"
      ? { title: "Safe Circle", body: `${name} ${arrived ? "llegó a" : "salió de"} ${place}` }
      : { title: "Safe Circle", body: `${name} ${arrived ? "arrived at" : "left"} ${place}` },
};

// Each recipient's language (profiles.language), English for anyone unknown.
export async function recipientLanguages(
  // deno-lint-ignore no-explicit-any
  supabase: { from: (table: string) => any },
  userIds: string[],
): Promise<Map<string, PushLanguage>> {
  const languages = new Map<string, PushLanguage>();
  if (userIds.length === 0) return languages;
  const { data } = await supabase.from("profiles").select("id, language").in("id", userIds);
  for (const row of (data ?? []) as { id: string; language: string | null }[]) {
    languages.set(row.id, row.language === "es" ? "es" : "en");
  }
  return languages;
}
