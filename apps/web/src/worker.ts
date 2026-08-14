type FetchBinding = {
  fetch(request: Request): Promise<Response>;
};

type VersionMetadata = {
  id: string;
  tag: string;
};

export type WebWorkerBindings = {
  API: FetchBinding;
  ASSETS: FetchBinding;
  CF_VERSION_METADATA?: VersionMetadata;
  DEPLOYED_GIT_SHA?: string;
  PLAID_WEBHOOK_HOST?: string;
};

export async function handleRequest(
  request: Request,
  bindings: WebWorkerBindings,
): Promise<Response> {
  const { hostname, pathname } = new URL(request.url);

  if (
    bindings.PLAID_WEBHOOK_HOST !== undefined &&
    hostname === bindings.PLAID_WEBHOOK_HOST
  ) {
    if (request.method === "POST" && pathname === "/webhooks/plaid") {
      return bindings.API.fetch(request);
    }
    return new Response(null, { status: 404 });
  }

  if (pathname === "/webhooks/plaid") {
    return new Response(null, { status: 404 });
  }

  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/health"
  ) {
    const response = await bindings.API.fetch(request);
    if (pathname !== "/health") {
      return response;
    }

    const headers = new Headers(response.headers);
    if (bindings.DEPLOYED_GIT_SHA !== undefined) {
      headers.set("X-Keel-Web-Git-Sha", bindings.DEPLOYED_GIT_SHA);
    }
    if (bindings.CF_VERSION_METADATA !== undefined) {
      headers.set("X-Keel-Web-Version-Id", bindings.CF_VERSION_METADATA.id);
      headers.set("X-Keel-Web-Version-Tag", bindings.CF_VERSION_METADATA.tag);
    }
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  return bindings.ASSETS.fetch(request);
}

export default {
  fetch: handleRequest,
};
