// Server-side plan table — the ONLY source of truth for amounts.
// Amounts are COP pesos in major units (e.g. 1490000 = $1.490.000 COP).
// The client sends a plan_key only; the server decides the price. Never
// trust a client-supplied amount (mipago runbook, hard rule #2).
//
// Market basis (researched 2026-10, Colombian market):
//  - landing:  $400k–$3.5M COP depending on tier (Muselab, Plago, CES, Cangrejo Digital)
//  - chatbot:  SaaS $19–169 USD/mo, LIWA $299k COP/mo, custom dev €2k–15k (VanguardIA)
//  - laser:    US event packages $750–$2,000 USD, facade campaigns higher (Kvant/Lasertronic)
//  - tour360:  ~$700k COP per aerial 360 point (Air Photo Colombia), US $100–250/point

export const PLANS = {
  landing: {
    key: 'landing',
    name: 'Landing Page de Conversión',
    shortName: 'Landing Page',
    description: 'Landing page de conversión — diseño personalizado, SEO base y CRO',
    amount: 1490000,
    currency: 'COP',
    delivery: '10–15 días hábiles',
  },
  chatbot: {
    key: 'chatbot',
    name: 'Agente IA / Chatbot',
    shortName: 'Chatbot IA',
    description: 'Implementación de agente IA en WhatsApp y web con calificación de leads',
    amount: 1990000,
    currency: 'COP',
    delivery: '2–3 semanas',
  },
  laser: {
    key: 'laser',
    name: 'Campaña de Publicidad Láser',
    shortName: 'Publicidad Láser',
    description: 'Proyección láser sobre fachada — 1 noche, contenido y operación incluidos',
    amount: 4900000,
    currency: 'COP',
    delivery: 'fecha coordinada con el cliente',
  },
  tour360: {
    key: 'tour360',
    name: 'Tour Virtual 360° con Dron',
    shortName: 'Tour 360° Dron',
    description: 'Tour virtual 360° — hasta 3 puntos aéreos, edición y hosting 1 año',
    amount: 1290000,
    currency: 'COP',
    delivery: '5–8 días hábiles',
  },
};

export function getPlan(key) {
  return Object.prototype.hasOwnProperty.call(PLANS, key) ? PLANS[key] : null;
}
