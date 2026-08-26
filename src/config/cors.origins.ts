export const LIVE_FRONTEND_ORIGINS = [
  'https://chatwave-pvj.vercel.app',
  'https://chatwave-frontend-alpha.vercel.app',
] as const;

export function frontendOrigins(frontendUrl: string): string[] {
  const listed = frontendUrl
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return [...new Set([...listed, ...LIVE_FRONTEND_ORIGINS, 'http://localhost:3000'])];
}
