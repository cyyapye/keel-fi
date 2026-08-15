const PLAID_LINK_SCRIPT_URL =
  "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

type PlaidLinkHandler = {
  destroy: () => void;
  open: () => void;
};

type PlaidLinkConfiguration = {
  onExit: (error: unknown) => void;
  onSuccess: (publicToken: string) => void;
  receivedRedirectUri?: string;
  token: string;
};

declare global {
  interface Window {
    Plaid?: {
      create: (configuration: PlaidLinkConfiguration) => PlaidLinkHandler;
    };
  }
}

let plaidScriptPromise: Promise<void> | null = null;

function loadPlaidLink(): Promise<void> {
  if (window.Plaid !== undefined) {
    return Promise.resolve();
  }
  if (plaidScriptPromise !== null) {
    return plaidScriptPromise;
  }

  plaidScriptPromise = new Promise<void>((resolve, reject) => {
    document
      .querySelector<HTMLScriptElement>(
        `script[src="${PLAID_LINK_SCRIPT_URL}"]`,
      )
      ?.remove();
    const script = document.createElement("script");
    const fail = () => {
      script.remove();
      plaidScriptPromise = null;
      reject(new Error("Plaid connection could not be opened."));
    };
    script.addEventListener(
      "load",
      () => (window.Plaid === undefined ? fail() : resolve()),
      { once: true },
    );
    script.addEventListener("error", fail, { once: true });
    script.async = true;
    script.src = PLAID_LINK_SCRIPT_URL;
    document.head.append(script);
  });
  return plaidScriptPromise;
}

export async function openPlaidLink(input: {
  linkToken: string;
  onExit: () => void;
  onSuccess: (publicToken: string) => void;
  receivedRedirectUri?: string;
}): Promise<PlaidLinkHandler> {
  await loadPlaidLink();
  if (window.Plaid === undefined) {
    throw new Error("Plaid connection could not be opened.");
  }
  const handler = window.Plaid.create({
    token: input.linkToken,
    onExit: () => {
      handler.destroy();
      input.onExit();
    },
    onSuccess: (publicToken) => {
      handler.destroy();
      input.onSuccess(publicToken);
    },
    ...(input.receivedRedirectUri === undefined
      ? {}
      : { receivedRedirectUri: input.receivedRedirectUri }),
  });
  try {
    handler.open();
  } catch (error) {
    handler.destroy();
    throw error;
  }
  return handler;
}
