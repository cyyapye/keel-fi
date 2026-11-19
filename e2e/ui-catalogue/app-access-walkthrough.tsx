import { useEffect, useRef, useState } from "react";
import {
  ActionGroup,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DataItem,
  DataList,
  EmptyState,
  LoadingStatus,
  Notice,
  RecordItem,
  SectionHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextLink,
} from "@keel/ui";

type Method = "apps" | "keys";
type Example =
  | "active"
  | "limited"
  | "loading"
  | "failed"
  | "empty"
  | "expired"
  | "disconnected";
const examples: Record<Example, string> = {
  active: "Active",
  limited: "Limited scope",
  loading: "Loading",
  failed: "List unavailable",
  empty: "Empty list",
  expired: "Expired",
  disconnected: "Disconnected",
};
const areas = ["Goals", "Holdings & valuations", "Cash & debts", "Evidence"];
let selectedMethod: Method = "apps";
let selectedExample: Example = "active";

export function AppAccessWalkthrough({ stepId }: { stepId: string }) {
  const [method, setMethod] = useState<Method>(selectedMethod);
  const [example, setExample] = useState<Example>(selectedExample);
  const [expanded, setExpanded] = useState(false);
  const [requestState, setRequestState] = useState("valid");
  const heading = useRef<HTMLElement>(null);
  useEffect(() => {
    setExpanded(false);
    heading.current?.focus();
  }, [stepId]);
  const request = stepId === "app-access-consent";
  const lifecycle = stepId === "app-access-lifecycle";
  const inactive = example === "expired" || example === "disconnected";
  const name = method === "apps" ? "Demo analysis app" : "Demo planning script";
  const limited = example === "limited" || method === "keys";
  const permissions = [
    method === "keys" ? "Manage goals" : "Read only",
    "Read only",
    limited ? "No access" : "Read only",
    limited ? "No access" : "Read only",
  ];
  const lifetime =
    method === "apps" ? "Until disconnected" : "Expires 16 February 2027";
  const status =
    example === "disconnected"
      ? "Disconnected · No current access"
      : example === "expired"
        ? "Expired 17 November 2026 · No current access"
        : lifetime;
  return (
    <section
      className="catalogue-decision-demo app-access-demo"
      aria-label="App access walkthrough"
      ref={heading}
      tabIndex={-1}
    >
      <SectionHeader
        title={
          request
            ? "Connection request"
            : lifecycle
              ? "Access lifetime"
              : "App access"
        }
      />
      {request ? (
        <>
          {requestState === "valid" ? (
            <>
              <SectionHeader
                title="Demo analysis app"
                description="Incoming request · Not connected"
                descriptionPlacement="title-group"
              />
              <p>
                This request starts in the app that wants to connect, not in
                Settings.
              </p>
              <DataList layout="rows">
                <DataItem
                  label="Goals"
                  value="Read only selected · Manage goals requested"
                />
                <DataItem
                  label="Holdings & valuations"
                  value="Read only selected and requested"
                />
                <DataItem
                  label="Cash & debts"
                  value="No access selected · Read only requested"
                />
                <DataItem
                  label="Evidence"
                  value="No access selected · Read only requested"
                />
                <DataItem label="Proposed lifetime" value="90 days" />
              </DataList>
              <p>
                Only the selected areas would be accessible. Full portfolio
                outlook and previews need all four areas.
              </p>
              <p className="catalogue-note">
                Permissions can be narrowed, never increased beyond the request.
                At least one area is required. Nothing is authorized in this
                walkthrough.
              </p>
            </>
          ) : (
            <Notice tone="error">
              {requestState === "invalid"
                ? "This connection request is invalid."
                : "The connection request could not be loaded."}{" "}
              No access has been granted.
            </Notice>
          )}
          <TextLink href="#journeys/app-access-settings">
            Back to app access
          </TextLink>
        </>
      ) : (
        <>
          <Tabs
            value={method}
            onValueChange={(value) => {
              if (
                typeof value === "string" &&
                (value === "apps" || value === "keys")
              ) {
                selectedMethod = value;
                setMethod(value);
                setExpanded(false);
              }
            }}
          >
            <TabsList variant="line" aria-label="Access method">
              <TabsTrigger value="apps">Connected apps</TabsTrigger>
              <TabsTrigger value="keys">API keys</TabsTrigger>
            </TabsList>
            {(["apps", "keys"] as const)
              .filter((tab) => tab === method)
              .map((tab) => (
                <TabsContent key={tab} value={tab}>
                  {example === "loading" ? (
                    <LoadingStatus>Loading access…</LoadingStatus>
                  ) : example === "failed" ? (
                    <Notice tone="error">
                      Access could not be loaded. Existing connections may still
                      have access.
                    </Notice>
                  ) : example === "empty" ? (
                    <EmptyState
                      compact
                      icon={null}
                      title={
                        tab === "apps" ? "No apps connected" : "No API keys yet"
                      }
                    >
                      {tab === "apps"
                        ? "Start a connection in the app you want to use."
                        : "API keys are created in Settings for tools that use a saved key."}
                    </EmptyState>
                  ) : (
                    <RecordItem
                      title={name}
                      detail={status}
                      action={
                        <Button
                          tone="quiet"
                          aria-expanded={expanded}
                          onClick={() => setExpanded(!expanded)}
                        >
                          {expanded ? "Hide access" : "View access"}
                        </Button>
                      }
                    >
                      {expanded && (
                        <div className="app-access-demo-details">
                          {inactive && (
                            <p>
                              Saved permissions below are inactive, not usable
                              access.
                            </p>
                          )}
                          <DataList layout="rows">
                            {areas.map((area, index) => (
                              <DataItem
                                key={area}
                                label={area}
                                value={permissions[index]}
                              />
                            ))}
                          </DataList>
                          <p>
                            Financial records cannot be changed.
                            {method === "keys"
                              ? " Managing goals allows creating, revising and archiving goals."
                              : ""}
                          </p>
                          {!inactive && (
                            <p className="catalogue-note">
                              {limited
                                ? "Selected areas remain accessible. Full portfolio outlook and previews need read access to all four areas."
                                : "Full portfolio outlook and what-if previews are included."}
                            </p>
                          )}
                        </div>
                      )}
                    </RecordItem>
                  )}
                </TabsContent>
              ))}
          </Tabs>
          {lifecycle ? (
            <>
              <p>
                {method === "apps"
                  ? "Apps renew sign-in within the allowed access period. Disconnecting ends that app’s access; switching models does not require another connection."
                  : "Replacing a key keeps its permissions and original access expiry. It does not extend access or add permissions."}
              </p>
              {method === "keys" && (
                <p className="catalogue-note">
                  A replacement is shown once in the product. Update the tool
                  before the previous key expires. Disconnecting ends the grant
                  and its replacements. No key is shown or created here.
                </p>
              )}
              <TextLink href="#journeys/app-access-settings">
                Back to app access
              </TextLink>
            </>
          ) : (
            <>
              <p className="catalogue-note">
                {method === "apps"
                  ? "Connect from the requesting app. Each app has its own permissions; switching models does not require reconnecting."
                  : "For scripts and tools with a saved key. Keys are separate from connected-app sign-in."}
              </p>
              <ActionGroup wrap>
                {method === "apps" && (
                  <TextLink href="#journeys/app-access-consent">
                    Inspect a connection request
                  </TextLink>
                )}
                <TextLink href="#journeys/app-access-lifecycle">
                  Access lifetime and key rotation
                </TextLink>
              </ActionGroup>
            </>
          )}
        </>
      )}
      <Collapsible>
        <CollapsibleTrigger render={<Button tone="quiet" />}>
          Prototype controls and source
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ActionGroup wrap>
            {request
              ? ["valid", "invalid", "failed"].map((value) => (
                  <Button
                    key={value}
                    tone={requestState === value ? "primary" : "secondary"}
                    aria-pressed={requestState === value}
                    onClick={() => setRequestState(value)}
                  >
                    {value === "valid"
                      ? "Valid request"
                      : value === "invalid"
                        ? "Invalid request"
                        : "Request unavailable"}
                  </Button>
                ))
              : (Object.keys(examples) as Example[]).map((value) => (
                  <Button
                    key={value}
                    tone={example === value ? "primary" : "secondary"}
                    aria-pressed={example === value}
                    onClick={() => {
                      selectedExample = value;
                      setExample(value);
                      setExpanded(false);
                    }}
                  >
                    {examples[value]}
                  </Button>
                ))}
          </ActionGroup>
          <p className="catalogue-note">
            Synthetic read-only examples, evaluated 18 November 2026. No
            authorization, credentials, clipboard, redirects or access changes.
            Source: apps/web/src/AppAccess.tsx and
            packages/domain/src/app-access.ts.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
