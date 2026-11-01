// A rejected fetch has no response or reliable write outcome. Keep recovery
// explicit: replaying a POST could create a duplicate accepted record.
export async function requestKeel(
  path: string,
  options: RequestInit,
): Promise<Response> {
  const saving = options.method !== undefined && options.method !== "GET";
  let response: Response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(
      saving
        ? "Keel could not confirm the save. Check your connection, then reload and check for the record before trying again."
        : "Keel could not be reached. Try again, or reload the page to refresh your session.",
      { cause: error },
    );
  }
  // An Access sign-in redirect can return HTML instead of the JSON contract.
  if (response.headers.get("Content-Type")?.includes("text/html")) {
    throw new Error(
      saving
        ? "Your session needs to be refreshed. Reload, sign in if asked, and check for the record before trying again."
        : "Your session needs to be refreshed. Reload the page and sign in if asked.",
    );
  }
  return response;
}
