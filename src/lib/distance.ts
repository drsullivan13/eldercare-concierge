/** Great-circle miles, never road miles or an agency's service-coverage boundary. */
export function distanceMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return (
    3958.7613 *
    2 *
    Math.atan2(Math.sqrt(Math.max(0, h)), Math.sqrt(Math.max(0, 1 - h)))
  );
}

export function providerDistanceMiles(
  origin: { lat: number; lng: number },
  { lat, lng }: { lat: number | null; lng: number | null },
): number | null {
  if (
    lat === null ||
    lng === null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  )
    return null;
  return distanceMiles(origin, { lat, lng });
}
