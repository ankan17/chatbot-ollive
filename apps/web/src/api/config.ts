export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export function buildUrl(
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const base = `${API_BASE_URL}${path}`;
  if (!query) return base;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
