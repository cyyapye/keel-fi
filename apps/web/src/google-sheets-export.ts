import {
  LegalEntityExportTableSchema,
  type LegalEntityExportTable,
} from "@keel/domain/legal-entities";
import { z } from "zod";

const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const CREATE_SPREADSHEET_URL = "https://sheets.googleapis.com/v4/spreadsheets";

type TokenConfiguration = {
  client_id: string;
  scope: string;
  include_granted_scopes: boolean;
  callback: (response: unknown) => void;
  error_callback: (error: unknown) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (configuration: TokenConfiguration) => {
            requestAccessToken: () => void;
          };
        };
      };
    };
  }
}

const TokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive(),
  scope: z.string(),
});
const PopupErrorSchema = z.object({ type: z.string() });
const CreatedSpreadsheetSchema = z.object({
  spreadsheetId: z.string().regex(/^[a-zA-Z0-9_-]+$/u),
});

let scriptPromise: Promise<void> | null = null;

function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.oauth2 !== undefined) return Promise.resolve();
  if (scriptPromise !== null) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      window.clearTimeout(timer);
      script.remove();
      scriptPromise = null;
      reject(
        new Error("Google sign-in could not load. Try again, or download CSV."),
      );
    };
    const timer = window.setTimeout(fail, 15_000);
    script.addEventListener(
      "load",
      () => {
        if (window.google?.accounts?.oauth2 === undefined) {
          fail();
        } else {
          window.clearTimeout(timer);
          resolve();
        }
      },
      { once: true },
    );
    script.addEventListener("error", fail, { once: true });
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.async = true;
    document.head.append(script);
  });
  return scriptPromise;
}

// Prepare before the click so the account chooser opens directly from a user gesture.
// The returned function keeps each access token within that single export operation.
export async function prepareGoogleSheetsAuthorization(
  clientId: string,
): Promise<() => Promise<string>> {
  await loadGoogleIdentity();
  return () =>
    new Promise<string>((resolve, reject) => {
      const oauth = window.google?.accounts?.oauth2;
      if (oauth === undefined) {
        reject(
          new Error(
            "Google sign-in could not load. Try again, or download CSV.",
          ),
        );
        return;
      }
      oauth
        .initTokenClient({
          client_id: clientId,
          scope: DRIVE_FILE_SCOPE,
          include_granted_scopes: false,
          callback: (raw) => {
            const token = TokenSchema.safeParse(raw);
            if (
              !token.success ||
              !token.data.scope.split(/\s+/u).includes(DRIVE_FILE_SCOPE)
            ) {
              reject(
                new Error(
                  "Allow Keel to create the Google Sheet, or download CSV instead.",
                ),
              );
              return;
            }
            resolve(token.data.access_token);
          },
          error_callback: (raw) => {
            const error = PopupErrorSchema.safeParse(raw);
            reject(
              new Error(
                error.success && error.data.type === "popup_closed"
                  ? "Google sign-in was closed. Your export choices are unchanged."
                  : "Google sign-in could not open. Allow pop-ups for Keel and try again.",
              ),
            );
          },
        })
        .requestAccessToken();
    });
}

export function googleSheetsCreateBody(
  rawTable: LegalEntityExportTable,
): string {
  const table = LegalEntityExportTableSchema.parse(rawTable);
  const values = [table.columns, ...table.rows];
  if (
    table.rows.length > 10_000 ||
    values.some((row) => row.some((value) => value.length > 50_000))
  ) {
    throw new Error(
      "This export is too large for direct Google Sheets creation. Download CSV instead.",
    );
  }
  const body = JSON.stringify({
    properties: { title: table.title },
    sheets: [
      {
        properties: {
          sheetId: 0,
          title: "Legal entities",
          gridProperties: {
            rowCount: Math.max(2, values.length),
            columnCount: table.columns.length,
            frozenRowCount: 1,
          },
        },
        basicFilter: {
          range: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: values.length,
            startColumnIndex: 0,
            endColumnIndex: table.columns.length,
          },
        },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            columnMetadata: table.columns.map(() => ({ pixelSize: 200 })),
            rowData: values.map((row, index) => ({
              values: row.map((value) => ({
                // Explicit strings preserve identifiers, exact money and evidence without executing formulas.
                userEnteredValue: { stringValue: value },
                userEnteredFormat: {
                  wrapStrategy: "CLIP",
                  ...(index === 0 ? { textFormat: { bold: true } } : {}),
                },
              })),
            })),
          },
        ],
      },
    ],
  });
  if (new TextEncoder().encode(body).byteLength > 2_000_000) {
    throw new Error(
      "This export is too large for direct Google Sheets creation. Download CSV instead.",
    );
  }
  return body;
}

export class GoogleSheetsCreationUncertainError extends Error {
  constructor() {
    super(
      "Google may have created the sheet, but its link could not be confirmed. Check Google Drive before trying again.",
    );
  }
}

export async function createGoogleSheet(
  table: LegalEntityExportTable,
  accessToken: string,
): Promise<string> {
  const body = googleSheetsCreateBody(table);
  let response: Response;
  try {
    // One create includes all data. Never retry a create whose outcome is unknown.
    response = await fetch(CREATE_SPREADSHEET_URL, {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new GoogleSheetsCreationUncertainError();
  }
  if (response.status >= 500) throw new GoogleSheetsCreationUncertainError();
  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "Google is busy. Wait a moment and try again, or download CSV."
        : "Google did not allow this export. Try connecting again, or download CSV.",
    );
  }
  try {
    const created = CreatedSpreadsheetSchema.parse(await response.json());
    return `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`;
  } catch {
    throw new GoogleSheetsCreationUncertainError();
  }
}
