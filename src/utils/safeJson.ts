/**
 * OMS order ids are 64-bit Snowflakes (~3.3e17) — far beyond
 * Number.MAX_SAFE_INTEGER, so JSON.parse silently rounds them (#25: a cancel
 * sent ...540 for an order whose real id ends ...544). Quote known id fields
 * before parsing so they survive as strings.
 */
const BIG_ID_FIELDS = /"(omsOrderId)"\s*:\s*(\d{15,})/g;

export function parseJsonSafeIds(text: string): unknown {
  return JSON.parse(text.replace(BIG_ID_FIELDS, '"$1":"$2"'));
}
