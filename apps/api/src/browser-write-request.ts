export function isAllowedBrowserWrite(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;

  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null && site !== "same-origin") return false;

  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin !== null) return origin === expectedOrigin;

  const referer = request.headers.get("Referer");
  if (referer !== null) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }
  return site === "same-origin";
}
