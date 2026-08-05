type FetchBinding = {
  fetch(request: Request): Promise<Response>;
};

export type WebWorkerBindings = {
  API: FetchBinding;
  ASSETS: FetchBinding;
};

export function handleRequest(
  request: Request,
  bindings: WebWorkerBindings,
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/health"
  ) {
    return bindings.API.fetch(request);
  }

  return bindings.ASSETS.fetch(request);
}

export default {
  fetch: handleRequest,
};
