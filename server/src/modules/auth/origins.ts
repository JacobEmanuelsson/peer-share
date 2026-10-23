export function allowedOrigins(primary: string) {
  return [...new Set([new URL(primary).origin, ...(process.env.PUBLIC_APP_URL ? [new URL(process.env.PUBLIC_APP_URL).origin] : [])])];
}
export function isAllowedOrigin(value: string | undefined, primary: string) {
  return !!value && allowedOrigins(primary).includes(value);
}