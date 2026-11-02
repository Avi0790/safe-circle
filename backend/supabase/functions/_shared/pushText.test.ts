// node --test supabase/functions/_shared/*.test.ts   (Node 22.6+ runs TypeScript as is)
//
// Every alert the database sends, written exactly as send_alert_push's
// callers write it, must come out in Spanish for a Spanish speaker, keep
// names, places and typed text as they are, and stay untouched in English.
import { test } from "node:test";
import assert from "node:assert/strict";
import { localizePush, PUSH } from "./pushText.ts";

// [title, body, data.type] as the SQL builds them, and the Spanish expected
const ALERTS: [string, string, string | undefined, string, string][] = [
  ["🚗 Ana is on the way", "They accepted your ride request.", "ride",
   "🚗 Ana va en camino", "Aceptó tu solicitud de viaje."],
  ["👀 Ben saw your SOS", "They know and are responding.", "sos",
   "👀 Ben vio tu SOS", "Ya lo sabe y está respondiendo."],
  ["📵 Luis Ramirez has gone quiet", "Luis Ramirez hasn't sent a location for 22 minutes while clocked in. Their phone may be off or out of signal.", "quiet_phone",
   "📵 Luis Ramirez no da señales", "Luis Ramirez no ha enviado su ubicación en 22 minutos estando en turno. Puede que su teléfono esté apagado o sin señal."],
  ["📵 Luis has gone quiet", "Luis hasn't sent a location for 20 minutes while clocked in (since they clocked in). Their phone may be off or out of signal.", "quiet_phone",
   "📵 Luis no da señales", "Luis no ha enviado su ubicación en 20 minutos estando en turno (desde que marcó entrada). Puede que su teléfono esté apagado o sin señal."],
  ["⏰ Maya missed curfew", "Not at Home by 10:00 PM yet.", "curfew",
   "⏰ Maya no llegó a la hora", "Aún no está en Home a las 10:00 PM."],
  ["✅ Maya arrived safely", "Made it to Home.", "walk",
   "✅ Maya llegó bien", "Llegó a Home."],
  ["✅ You're in: Smith", "Open Safe Circle to see your circle.", "join_decision",
   "✅ Ya estás en: Smith", "Abre Safe Circle para ver tu círculo."],
  ["Request declined: Smith", "The creator didn't approve your request.", "join_decision",
   "Solicitud rechazada: Smith", "Quien creó el círculo no aprobó tu solicitud."],
  ["📅 You have a new shift", "Open Safe Circle to see when.", "schedule",
   "📅 Tienes un turno nuevo", "Abre Safe Circle para ver cuándo."],
  ["📅 A shift was cancelled", "Open Safe Circle to see your schedule.", "schedule",
   "📅 Se canceló un turno", "Abre Safe Circle para ver tu horario."],
  ["👑 You're now the owner of Smith", "The previous owner deleted their account, so the circle is yours.", "ownership",
   "👑 Ahora eres el propietario de Smith", "El propietario anterior eliminó su cuenta, así que el círculo ahora es tuyo."],
  ["Riverside closed", "Riverside was deleted by its owner. Nobody there can see you any more; your circles are unchanged.", "org_closed",
   "Riverside cerró", "Su propietario eliminó Riverside. Ya nadie allí puede verte; tus círculos no cambian."],
  ["🍕 Ana dropped a pin", "Pizza left on the table", "pin",
   "🍕 Ana marcó un punto", "Pizza left on the table"], // the label is hers: untouched
  ["✅ Maya checked in", "They're safe.", "safety_timer",
   "✅ Maya se reportó", "Está a salvo."],
  ["✅ Maya arrived", "They got to Grandma's house.", "shared_trip",
   "✅ Maya llegó", "Llegó a Grandma's house."],
  ["✅ Maya is safe", "They ended their walk to Library.", "walk",
   "✅ Maya está a salvo", "Terminó su caminata a Library."],
  ["⏱️ Missed check-in", "Jordan Lee missed a scheduled check-in.", "checkin",
   "⏱️ Reporte no realizado", "Jordan Lee no hizo un reporte programado."],
  ["⏱️ Missed check-in", "Jordan Lee missed a scheduled check-in and there is no location to show.", "checkin",
   "⏱️ Reporte no realizado", "Jordan Lee no hizo un reporte programado y no hay ubicación para mostrar."],
  ["🆘 Still no one has responded", "Maya's SOS from 09:15 PM needs someone to check it.", "sos",
   "🆘 Todavía nadie ha respondido", "El SOS de Maya de las 09:15 PM necesita que alguien lo revise."],
  ["⏰ Your check-on-me timer ran out", 'Your circle was alerted. Open Safe Circle and tap "I\'m safe" if you\'re okay.', "safety_timer",
   '⏰ Se acabó tu temporizador de "Revisa que esté bien"', 'Se avisó a tu círculo. Abre Safe Circle y toca "Estoy a salvo" si estás bien.'],
  ["⏰ Your walk timer ran out", 'Your circle was alerted. Open Safe Circle and tap "I\'m safe" if you\'re okay.', "walk",
   "⏰ Se acabó el tiempo de tu caminata", 'Se avisó a tu círculo. Abre Safe Circle y toca "Estoy a salvo" si estás bien.'],
  ["👋 Ben wants to join Smith", "Open Safe Circle → Settings to approve or deny.", "join_request",
   "👋 Ben quiere unirse a Smith", "Abre Safe Circle → Ajustes para aprobar o rechazar."],
  ["🆘 SOS: Aisha Khan needs help", "Aisha Khan sent an SOS while clocked in at Demo Crew. Open Safe Circle to see where.", "sos",
   "🆘 SOS: Aisha Khan necesita ayuda", "Aisha Khan envió un SOS estando en turno en Demo Crew. Abre Safe Circle para ver dónde."],
  ["🆘 SOS: Aisha needs help", "Aisha sent an SOS while clocked in. Open Safe Circle to see where.", "sos",
   "🆘 SOS: Aisha necesita ayuda", "Aisha envió un SOS estando en turno. Abre Safe Circle para ver dónde."],
  ["🚗 Maya needs a ride", "About 1.4 mi from you. Open Safe Circle to help.", "ride",
   "🚗 Maya necesita que lo lleven", "A unas 1.4 mi de ti. Abre Safe Circle para ayudar."],
  ["🚗 Maya needs a ride", "Open Safe Circle to help.", "ride",
   "🚗 Maya necesita que lo lleven", "Abre Safe Circle para ayudar."],
  ["✅ Priya checked in", "They're OK.", "checkin",
   "✅ Priya se reportó", "Está bien."],
  ["⏱️ Maya asked to be checked on", "First date — due in 90 min.", "safety_timer",
   "⏱️ Maya pidió que lo revisen", "First date — vence en 90 min."],
  ["⏱️ Maya asked to be checked on", "No note — due in 30 min.", "safety_timer",
   "⏱️ Maya pidió que lo revisen", "Sin nota — vence en 30 min."],
  ["🚗 Maya is on the way", "Heading to Grandma's house, arriving in about 25 min.", "shared_trip",
   "🚗 Maya va en camino", "Va a Grandma's house; llega en unos 25 min."],
  ["🚶 Maya is walking", "Walking to Library, arriving in about 1 h 30 min.", "shared_trip",
   "🚶 Maya está caminando", "Camina a Library; llega en unos 1 h 30 min."],
  ["🚌 Maya is on the bus", "Heading to Downtown, arriving in about 2 h.", "shared_trip",
   "🚌 Maya va en autobús", "Va a Downtown; llega en unos 2 h."],
  ["🚆 Maya is on the train", "Heading to Chicago, arriving in about 3 h.", "shared_trip",
   "🚆 Maya va en tren", "Va a Chicago; llega en unos 3 h."],
  ["✈️ Maya is flying", "Flying to Dallas, landing in about 2 h 10 min.", "shared_trip",
   "✈️ Maya está volando", "Vuela a Dallas; aterriza en unos 2 h 10 min."],
  ["🚶 Maya is walking to Home", "Due within 20 min. You'll be alerted if they don't arrive.", "walk",
   "🚶 Maya está caminando a Home", "Debe llegar en 20 min. Se te avisará si no llega."],
  ["⚠️ Hazard reported by Wendy Worker", "Loose scaffolding on level 3", "incident",
   "⚠️ Peligro reportado por Wendy Worker", "Loose scaffolding on level 3"], // the note is hers: untouched
  ["⚠️ Near miss reported by Walt", "Forklift left running", "incident",
   "⚠️ Casi accidente reportado por Walt", "Forklift left running"],
  ["👑 You're now the owner of Smith", "Ana made you the creator. You can rename it, remove members and manage join approvals.", "ownership",
   "👑 Ahora eres el propietario de Smith", "Ana te hizo creador. Puedes renombrarlo, quitar miembros y administrar las aprobaciones."],
];

test("every alert the database sends arrives in Spanish for a Spanish speaker", () => {
  for (const [title, body, type, esTitle, esBody] of ALERTS) {
    assert.deepEqual(localizePush("es", title, body, type), { title: esTitle, body: esBody }, title);
  }
});

test("English speakers get the English untouched", () => {
  for (const [title, body, type] of ALERTS) {
    assert.deepEqual(localizePush("en", title, body, type), { title, body });
  }
});

test("an alert no rule knows is delivered in English rather than garbled", () => {
  assert.deepEqual(localizePush("es", "🧪 Something new", "A message added later."), {
    title: "🧪 Something new",
    body: "A message added later.",
  });
});

test("the Edge Functions' own messages, in both languages", () => {
  assert.deepEqual(PUSH.lowBattery("en", "Ana", 12), {
    title: "🔋 Low battery",
    body: "Ana's phone is at 12% — location sharing may stop soon.",
  });
  assert.deepEqual(PUSH.lowBattery("es", "Ana", 12), {
    title: "🔋 Batería baja",
    body: "El teléfono de Ana está al 12%; puede dejar de compartir su ubicación pronto.",
  });
  assert.equal(PUSH.nearby("en", "Ben", 0.05).body, "Ben is nearby — right next to you");
  assert.equal(PUSH.nearby("es", "Ben", 0.42).body, "Ben está cerca — a 0.4 mi");
  assert.deepEqual(PUSH.sos("es", "Maya", "Car broke down"), { title: "🆘 SOS", body: '¡Maya necesita ayuda! "Car broke down"' });
  assert.equal(PUSH.sos("en", "Maya", null).body, "Maya needs help!");
  // automatic SOS messages are translated; typed ones are not
  assert.equal(
    PUSH.sos("es", "Maya", "Automatic alert: a possible fall was detected and they didn't respond for 30 seconds. This is their location.").body,
    '¡Maya necesita ayuda! "Alerta automática: se detectó una posible caída y no respondió en 30 segundos. Esta es su ubicación."',
  );
  assert.equal(
    PUSH.sos("es", "Maya", "Automatic alert: didn't arrive at Home before their walk timer ran out. This is their last known location.").body,
    '¡Maya necesita ayuda! "Alerta automática: no llegó a Home antes de que se acabara su tiempo de caminata. Esta es su última ubicación conocida."',
  );
  assert.equal(
    PUSH.sos("en", "Maya", "Automatic alert: a possible fall was detected and they didn't respond for 30 seconds. This is their location.").body,
    'Maya needs help! "Automatic alert: a possible fall was detected and they didn\'t respond for 30 seconds. This is their location."',
  );
  assert.equal(PUSH.place("es", "Maya", true, "Home").body, "Maya llegó a Home");
  assert.equal(PUSH.place("en", "Maya", false, "School").body, "Maya left School");
});
