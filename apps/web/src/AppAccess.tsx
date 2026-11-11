import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { z } from "zod";
import {
  AppAccessStateSchema,
  AuthorizationContextSchema,
  AuthorizationReceiptSchema,
  KeyInputSchema,
  KeyReceiptSchema,
  permissionScopes,
  type AppGrant,
  type AppPermissions,
} from "@keel/domain/app-access";
import {
  ActionGroup,
  Button,
  ChoiceGroup,
  DataList,
  DataItem,
  EmptyState,
  Field,
  FormMessage,
  Input,
  LoadingStatus,
  Notice,
  PageHeader,
  RecordItem,
  Screen,
  SectionHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextLink,
} from "@keel/ui";
import { requestKeel } from "./api-request";
import "./app-access.css";

const defaults = (): AppPermissions => ({
  goals: "read",
  holdings: "read",
  cash: "read",
  evidence: "read",
});
const areas = [
  { key: "goals", label: "Goals" },
  { key: "holdings", label: "Holdings & valuations" },
  { key: "cash", label: "Cash & debts" },
  { key: "evidence", label: "Evidence" },
] as const;
const labels = { none: "No access", read: "Read only", manage: "Manage goals" };
async function api<T extends z.ZodType>(
  path: string,
  schema: T,
  body?: unknown,
  signal?: AbortSignal,
  method = "POST",
): Promise<z.output<T>> {
  const response = await requestKeel(path, {
    method: body === undefined ? "GET" : method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Keel-App-Access": "1",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const e = z.object({ error: z.string() }).safeParse(value);
    throw new Error(
      e.success ? e.data.error : "Keel could not complete this request.",
    );
  }
  return schema.parse(value);
}
function Menu({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label} variant="filled">
      {(props) => (
        <Select
          value={value}
          items={options}
          disabled={disabled}
          onValueChange={(next) => {
            if (typeof next === "string") onChange(next);
          }}
        >
          <SelectTrigger {...props}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}
function Permissions({
  value,
  onChange,
  disabled = false,
  maximum,
}: {
  value: AppPermissions;
  onChange: (next: AppPermissions) => void;
  disabled?: boolean;
  maximum?: AppPermissions;
}) {
  const full = Object.values(value).every((v) => v !== "none");
  return (
    <div className="app-access__permissions">
      <h3>Permissions</h3>
      <div className="app-access__fields">
        {areas.map((area) => {
          const choices =
            area.key === "goals"
              ? (["none", "read", "manage"] as const)
              : (["none", "read"] as const);
          const available = choices.filter(
            (v) =>
              !maximum ||
              v === "none" ||
              (maximum[area.key] !== "none" &&
                (v !== "manage" || maximum.goals === "manage")),
          );
          return (
            <Menu
              key={area.key}
              label={area.label}
              value={value[area.key]}
              options={available.map((v) => ({ value: v, label: labels[v] }))}
              disabled={disabled}
              onChange={(v) => onChange({ ...value, [area.key]: v })}
            />
          );
        })}
      </div>
      <p>
        {full
          ? "Full portfolio outlook and what-if previews are included."
          : "Full portfolio outlook and previews need read access to all four areas. Your selected areas remain accessible."}
      </p>
      <p>
        Financial records cannot be changed.
        {value.goals === "manage"
          ? " This connection may create, revise and archive your goals."
          : ""}
      </p>
      {permissionScopes(value).length === 0 && (
        <FormMessage tone="error">
          Choose access to at least one area.
        </FormMessage>
      )}
    </div>
  );
}
function AccessDetails({
  grant,
  includeLifetime = true,
}: {
  grant: AppGrant;
  includeLifetime?: boolean;
}) {
  return (
    <div className="app-access__details">
      <DataList>
        {areas.map((area) => (
          <DataItem
            key={area.key}
            label={area.label}
            value={labels[grant.permissions[area.key]]}
          />
        ))}
      </DataList>
      {includeLifetime && (
        <p>
          {grant.expiresAt
            ? "Access expires " + new Date(grant.expiresAt).toLocaleString()
            : "Access lasts until you disconnect."}
        </p>
      )}
      {grant.kind === "key" && (
        <p>
          {grant.rotation === "agent"
            ? "Agent may rotate its own key."
            : "You rotate this key in Keel."}{" "}
          Rotation preserves permissions and access expiry.
        </p>
      )}
    </div>
  );
}
function CopyValue({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [message, setMessage] = useState("");
  return (
    <div className="app-access__copy">
      <Field label={label} variant="filled">
        {(props) => (
          <Input
            {...props}
            readOnly
            value={value}
            autoComplete="off"
            spellCheck={false}
            {...(secret ? { "data-secret": "true" } : {})}
          />
        )}
      </Field>
      <Button
        tone="secondary"
        onClick={() => {
          void navigator.clipboard
            .writeText(value)
            .then(() => setMessage("Copied."))
            .catch(() =>
              setMessage(
                "Copy was unavailable. Select the value and copy it manually.",
              ),
            );
        }}
      >
        Copy {label.toLowerCase()}
      </Button>
      {message && <FormMessage>{message}</FormMessage>}
    </div>
  );
}
export function AppAccess() {
  const incoming = window.location.pathname === "/oauth/authorize";
  const incomingParams = new URLSearchParams(window.location.search);
  const invalidIncoming =
    incoming && new Set(incomingParams.keys()).size !== incomingParams.size;
  const [tab, setTab] = useState("apps"),
    [pageAfter, setPageAfter] = useState<string | null>(null),
    [state, setState] = useState<z.infer<typeof AppAccessStateSchema> | null>(
      null,
    ),
    [loading, setLoading] = useState(!invalidIncoming),
    [loadError, setLoadError] = useState<string | null>(
      invalidIncoming
        ? "This app request is invalid. Start again in the app."
        : null,
    );
  const [name, setName] = useState("Planning agent"),
    [nameTouched, setNameTouched] = useState(false),
    [permissions, setPermissions] = useState(defaults),
    [days, setDays] = useState("90"),
    [rotation, setRotation] = useState("manual");
  const [receipt, setReceipt] = useState<z.infer<
      typeof KeyReceiptSchema
    > | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<string | null>(null),
    [uncertain, setUncertain] = useState(false);
  const [detail, setDetail] = useState<string | null>(null),
    [revoke, setRevoke] = useState<string | null>(null),
    [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const [context, setContext] = useState<z.infer<
      typeof AuthorizationContextSchema
    > | null>(null),
    [duration, setDuration] = useState("ongoing");
  const abort = useRef<AbortController | null>(null),
    pending = useRef(false),
    heading = useRef<HTMLHeadingElement | null>(null);
  const load = useCallback(
    (after: string | null = null) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      return api(
        "/api/app-access?kind=" +
          (tab === "apps" ? "oauth" : "key") +
          (after ? "&after=" + encodeURIComponent(after) : ""),
        AppAccessStateSchema,
        undefined,
        controller.signal,
      )
        .then((next) => {
          if (!controller.signal.aborted) setState(next);
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted)
            setLoadError(
              e instanceof Error
                ? e.message
                : "App access could not be loaded.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    },
    [tab],
  );
  useEffect(() => {
    if (!incoming) {
      void load();
      return () => abort.current?.abort();
    }
    const controller = new AbortController();
    const params = new URLSearchParams(window.location.search);
    if (invalidIncoming) return;
    void api(
      "/api/app-access/authorization-context",
      AuthorizationContextSchema,
      Object.fromEntries(params),
      controller.signal,
    )
      .then((value) => {
        setContext(value);
        setPermissions(value.permissions);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setLoadError(
            e instanceof Error ? e.message : "This app request is invalid.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [incoming, invalidIncoming, load]);
  function refresh(after: string | null = null) {
    setPageAfter(after);
    setLoading(true);
    setLoadError(null);
    void load(after);
  }
  async function mutate(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await work();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Keel could not confirm this change.";
      setFailure(message);
      if (/could not confirm|check for the record/i.test(message))
        setUncertain(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function showReceipt(value: z.infer<typeof KeyReceiptSchema>) {
    setReceipt(value);
    setState((previous) =>
      previous
        ? {
            ...previous,
            grants: [
              value.grant,
              ...previous.grants.filter((g) => g.id !== value.grant.id),
            ].slice(0, 50),
          }
        : previous,
    );
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: "center" });
    });
    if (pageAfter !== null) refresh();
  }
  function create(event: FormEvent) {
    event.preventDefault();
    const input = KeyInputSchema.safeParse({
      name,
      permissions,
      durationDays: Number(days),
      rotation,
    });
    if (!input.success) {
      setFailure(
        !name.trim()
          ? "Enter a key name."
          : "Choose access to at least one area.",
      );
      return;
    }
    void mutate(async () =>
      showReceipt(
        await api("/api/app-access/keys", KeyReceiptSchema, input.data),
      ),
    );
  }
  if (incoming)
    return (
      <Screen className="app-access">
        <PageHeader
          title={
            context
              ? "Allow " + context.name + " to access Keel?"
              : "Connect an app"
          }
          description={
            context
              ? context.clientOrigin +
                " is requesting access to your portfolio."
              : undefined
          }
        />
        {loading ? (
          <LoadingStatus>Checking the app request…</LoadingStatus>
        ) : loadError ? (
          <Notice tone="error">{loadError}</Notice>
        ) : context ? (
          <form
            className="app-access__form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!permissionScopes(permissions).length) {
                setFailure("Choose access to at least one area.");
                return;
              }
              void mutate(async () => {
                const result = await api(
                  "/api/app-access/authorize",
                  AuthorizationReceiptSchema,
                  {
                    request: context.request,
                    permissions,
                    durationDays:
                      duration === "ongoing" ? null : Number(duration),
                  },
                );
                window.location.assign(result.redirectUrl);
              });
            }}
          >
            <Permissions
              value={permissions}
              onChange={setPermissions}
              maximum={context.requestedPermissions}
              disabled={busy}
            />
            <Menu
              label="Access lasts"
              value={duration}
              options={[
                { value: "ongoing", label: "Until you disconnect" },
                { value: "90", label: "90 days" },
                { value: "365", label: "1 year" },
              ]}
              onChange={setDuration}
              disabled={busy}
            />
            <p>
              The app renews its sign-in automatically within this access
              period. You can disconnect it in Settings at any time.
            </p>
            {failure && <FormMessage tone="error">{failure}</FormMessage>}
            <ActionGroup wrap>
              <Button
                tone="primary"
                type="submit"
                disabled={
                  busy ||
                  uncertain ||
                  permissionScopes(permissions).length === 0
                }
              >
                {busy ? "Connecting…" : "Allow access"}
              </Button>
              <Button
                tone="secondary"
                disabled={busy}
                onClick={() => {
                  const url = new URL(context.request.redirect_uri);
                  url.searchParams.set("error", "access_denied");
                  if (context.request.state !== undefined)
                    url.searchParams.set("state", context.request.state);
                  window.location.assign(url.href);
                }}
              >
                Cancel
              </Button>
            </ActionGroup>
          </form>
        ) : null}
      </Screen>
    );
  const listed =
    state?.grants.filter(
      (g) => g.kind === (tab === "apps" ? "oauth" : "key"),
    ) ?? [];
  return (
    <Screen className="app-access">
      <PageHeader
        title="App access"
        description="Choose what your apps and agents can access in Keel."
      />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (typeof value === "string" && value !== tab) {
            setPageAfter(null);
            setLoading(true);
            setLoadError(null);
            setTab(value);
            setFailure(null);
            setRevoke(null);
            setRename(null);
          }
        }}
      >
        <TabsList variant="line" aria-label="Access method">
          <TabsTrigger value="apps">Connected apps</TabsTrigger>
          <TabsTrigger value="keys">API keys</TabsTrigger>
        </TabsList>
        <TabsContent value="apps">
          <section className="app-access__section">
            <SectionHeader title="Connect from your app" />
            <p>
              Add Keel as a custom MCP connector in ChatGPT, Claude or another
              compatible app, then choose OAuth and sign in to Keel.
            </p>
            {state && <CopyValue label="Server URL" value={state.mcpUrl} />}
            <p>
              Choose permissions when the app asks to connect. Each app has its
              own access; switching models does not require a new connection.
            </p>
          </section>
        </TabsContent>
        <TabsContent value="keys">
          <section className="app-access__section">
            {receipt ? (
              <div className="app-access__form">
                <h2 ref={heading} tabIndex={-1}>
                  Save your{" "}
                  {receipt.grant.previousKeyExpiresAt ? "replacement " : ""}key
                </h2>
                <p>
                  Copy it now. Keel cannot show this key again. Save it in your
                  tool’s credential settings.
                </p>
                <CopyValue label="API key" value={receipt.key} secret />
                <AccessDetails grant={receipt.grant} />
                {receipt.grant.previousKeyExpiresAt && (
                  <Notice>
                    Update your tool before{" "}
                    {new Date(
                      receipt.grant.previousKeyExpiresAt,
                    ).toLocaleString()}
                    . The previous key then stops working.
                  </Notice>
                )}
                {state && (
                  <CopyValue
                    label="API URL"
                    value={state.apiOrigin + "/api/v1"}
                  />
                )}
                <Button
                  onClick={() => {
                    setReceipt(null);
                    setName("Planning agent");
                    setPermissions(defaults());
                    setDays("90");
                    setRotation("manual");
                  }}
                >
                  Done
                </Button>
              </div>
            ) : (
              <form className="app-access__form" onSubmit={create}>
                <SectionHeader
                  title="Create an API key"
                  description="For scripts, coding agents and tools that use a saved key."
                />
                <Field
                  label="Key name"
                  variant="filled"
                  error={
                    nameTouched && !name.trim()
                      ? "Enter a key name."
                      : undefined
                  }
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={name}
                      maxLength={64}
                      disabled={busy}
                      onChange={(event) => setName(event.target.value)}
                      onBlur={() => setNameTouched(true)}
                      autoComplete="off"
                    />
                  )}
                </Field>
                <Permissions
                  value={permissions}
                  onChange={setPermissions}
                  disabled={busy}
                />
                <Menu
                  label="Access expires in"
                  value={days}
                  options={[
                    { value: "30", label: "30 days" },
                    { value: "90", label: "90 days" },
                    { value: "365", label: "1 year" },
                  ]}
                  onChange={setDays}
                  disabled={busy}
                />
                <ChoiceGroup
                  label="Key rotation"
                  value={rotation}
                  onValueChange={setRotation}
                  disabled={busy}
                  options={[
                    {
                      value: "manual",
                      label: "You rotate it",
                      content:
                        "Create a replacement in Keel, then update your tool.",
                    },
                    {
                      value: "agent",
                      label: "Agent may rotate",
                      content:
                        "Let an agent replace its own saved key before it expires.",
                    },
                  ]}
                />
                <p>Rotation keeps the same permissions and access expiry.</p>
                {failure && <FormMessage tone="error">{failure}</FormMessage>}
                <Button
                  tone="primary"
                  type="submit"
                  disabled={
                    busy ||
                    uncertain ||
                    !name.trim() ||
                    permissionScopes(permissions).length === 0
                  }
                >
                  {busy ? "Creating…" : "Create key"}
                </Button>
              </form>
            )}
            {state && (
              <p className="app-access__docs">
                Use <code>Authorization: Bearer YOUR_KEY</code>.{" "}
                <TextLink
                  href={state.openApiUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  API schema and endpoints
                </TextLink>
              </p>
            )}
          </section>
        </TabsContent>
        <section className="app-access__section app-access__saved">
          <SectionHeader
            title={tab === "apps" ? "Connected apps" : "Your API keys"}
          />
          {loading ? (
            <LoadingStatus>Loading access…</LoadingStatus>
          ) : loadError ? (
            <Notice tone="error">
              {loadError}{" "}
              <Button tone="secondary" onClick={() => refresh()}>
                Try again
              </Button>
            </Notice>
          ) : (
            <>
              {!listed.length && (
                <EmptyState
                  compact
                  icon={null}
                  title={
                    state?.nextAfter
                      ? "No matching connections on this page"
                      : tab === "apps"
                        ? "No apps connected"
                        : "No API keys yet"
                  }
                >
                  {tab === "apps"
                    ? "Start the connection in the app you want to use."
                    : "Create a key above to connect a tool."}
                </EmptyState>
              )}
              {listed.map((grant) => {
                const expired =
                    grant.expiresAt !== null &&
                    grant.expiresAt <= (state?.evaluatedAt ?? ""),
                  inactive = !!grant.revokedAt || expired;
                return (
                  <RecordItem
                    key={grant.id}
                    title={grant.name}
                    detail={
                      grant.revokedAt
                        ? "Disconnected"
                        : expired
                          ? "Expired"
                          : grant.expiresAt
                            ? "Expires " +
                              new Date(grant.expiresAt).toLocaleString()
                            : "Until disconnected"
                    }
                    metadata={
                      grant.suffix
                        ? "Key ending " + grant.suffix
                        : grant.clientOrigin
                    }
                    action={
                      <>
                        <Button
                          tone="quiet"
                          onClick={() =>
                            setDetail(detail === grant.id ? null : grant.id)
                          }
                          aria-expanded={detail === grant.id}
                        >
                          {detail === grant.id ? "Hide access" : "View access"}
                        </Button>
                        {grant.kind === "key" && !inactive && (
                          <>
                            <Button
                              tone="quiet"
                              disabled={busy || uncertain}
                              onClick={() =>
                                setRename({ id: grant.id, name: grant.name })
                              }
                            >
                              Rename
                            </Button>
                            <Button
                              tone="secondary"
                              disabled={
                                busy ||
                                uncertain ||
                                !!(
                                  grant.previousKeyExpiresAt &&
                                  grant.previousKeyExpiresAt >
                                    (state?.evaluatedAt ?? "")
                                )
                              }
                              onClick={() =>
                                void mutate(async () =>
                                  showReceipt(
                                    await api(
                                      "/api/app-access/" + grant.id + "/rotate",
                                      KeyReceiptSchema,
                                      {},
                                    ),
                                  ),
                                )
                              }
                            >
                              Rotate key
                            </Button>
                          </>
                        )}
                        {!inactive && (
                          <Button
                            tone="quiet"
                            disabled={busy || uncertain}
                            onClick={() => setRevoke(grant.id)}
                          >
                            {grant.kind === "key" ? "Revoke" : "Disconnect"}
                          </Button>
                        )}
                      </>
                    }
                  >
                    {detail === grant.id && (
                      <AccessDetails grant={grant} includeLifetime={false} />
                    )}
                    {grant.previousKeyExpiresAt &&
                      grant.previousKeyExpiresAt > (state?.evaluatedAt ?? "") &&
                      !inactive && (
                        <p>
                          A replacement is pending. The previous key stops
                          working{" "}
                          {new Date(
                            grant.previousKeyExpiresAt,
                          ).toLocaleString()}
                          .
                        </p>
                      )}
                    {rename?.id === grant.id && (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void mutate(async () => {
                            await api(
                              "/api/app-access/" + grant.id,
                              z.object({ renamed: z.literal(true) }),
                              { name: rename.name },
                              undefined,
                              "PATCH",
                            );
                            setState((s) =>
                              s
                                ? {
                                    ...s,
                                    grants: s.grants.map((g) =>
                                      g.id === grant.id
                                        ? { ...g, name: rename.name.trim() }
                                        : g,
                                    ),
                                  }
                                : s,
                            );
                            setRename(null);
                          });
                        }}
                      >
                        <Field label="New key name" variant="filled">
                          {(props) => (
                            <Input
                              {...props}
                              value={rename.name}
                              maxLength={64}
                              required
                              disabled={busy}
                              onChange={(e) =>
                                setRename({ ...rename, name: e.target.value })
                              }
                            />
                          )}
                        </Field>
                        <ActionGroup>
                          <Button
                            tone="primary"
                            type="submit"
                            disabled={busy || uncertain || !rename.name.trim()}
                          >
                            Save name
                          </Button>
                          <Button
                            tone="quiet"
                            disabled={busy}
                            onClick={() => setRename(null)}
                          >
                            Cancel
                          </Button>
                        </ActionGroup>
                      </form>
                    )}
                    {revoke === grant.id && (
                      <div>
                        <p>
                          {grant.kind === "key"
                            ? "Revoke this key and all its replacements? Your tool will lose access immediately."
                            : "Disconnect this app? It will lose access immediately."}
                        </p>
                        <ActionGroup wrap>
                          <Button
                            tone="danger"
                            disabled={busy || uncertain}
                            onClick={() =>
                              void mutate(async () => {
                                await api(
                                  "/api/app-access/" + grant.id + "/revoke",
                                  z.object({ revoked: z.literal(true) }),
                                  {},
                                );
                                setState((s) =>
                                  s
                                    ? {
                                        ...s,
                                        grants: s.grants.map((g) =>
                                          g.id === grant.id
                                            ? {
                                                ...g,
                                                revokedAt:
                                                  new Date().toISOString(),
                                              }
                                            : g,
                                        ),
                                      }
                                    : s,
                                );
                                setRevoke(null);
                              })
                            }
                          >
                            {busy
                              ? "Disconnecting…"
                              : "Confirm " +
                                (grant.kind === "key"
                                  ? "revoke"
                                  : "disconnect")}
                          </Button>
                          <Button
                            tone="secondary"
                            disabled={busy}
                            onClick={() => setRevoke(null)}
                          >
                            Cancel
                          </Button>
                        </ActionGroup>
                      </div>
                    )}
                  </RecordItem>
                );
              })}
              {(state?.nextAfter || pageAfter !== null) && (
                <ActionGroup>
                  {state?.nextAfter && (
                    <Button
                      tone="secondary"
                      disabled={loading}
                      onClick={() => refresh(state.nextAfter)}
                    >
                      Next page
                    </Button>
                  )}
                  {pageAfter !== null && (
                    <Button
                      tone="quiet"
                      disabled={loading}
                      onClick={() => refresh()}
                    >
                      Newest first
                    </Button>
                  )}
                </ActionGroup>
              )}
            </>
          )}
          {failure && (tab === "apps" || receipt || revoke || rename) && (
            <FormMessage tone="error">{failure}</FormMessage>
          )}
        </section>
      </Tabs>
    </Screen>
  );
}
