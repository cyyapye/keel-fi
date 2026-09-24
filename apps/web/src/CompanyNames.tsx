import { useEffect, useState } from "react";
import {
  ActionGroup,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  Field,
  FormMessage,
  Input,
  PageHeader,
  SearchSelect,
  SectionHeader,
  Textarea,
  TextLink,
} from "@keel/ui";
import {
  CompanyAliasProposalSchema,
  CompanyAliasReviewInputSchema,
  type CompanyAliasPreview,
  type CompanyAliasReceipt,
  type CompanyIdentityCatalog,
} from "@keel/domain/company-identity";
import {
  loadCompanyIdentities,
  previewCompanyAlias,
  reviewCompanyAlias,
} from "./api";
import { PublicCompanyLinkEditor } from "./PublicCompanyLinkEditor";

export function CompanyNames() {
  const publicExposureId = new URLSearchParams(window.location.search).get(
    "public",
  );
  const [catalog, setCatalog] = useState<CompanyIdentityCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [sourceId, setSourceId] = useState("other");
  const [companyId, setCompanyId] = useState(
    () => new URLSearchParams(window.location.search).get("company") ?? "",
  );
  const [name, setName] = useState(
    () => new URLSearchParams(window.location.search).get("name") ?? "",
  );
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<CompanyAliasPreview | null>(null);
  const [saved, setSaved] = useState<CompanyAliasReceipt | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [working, setWorking] = useState<"preview" | "save" | null>(null);
  const [visibleGroups, setVisibleGroups] = useState(20);
  useEffect(() => {
    const abort = new AbortController();
    void loadCompanyIdentities(abort.signal)
      .then(setCatalog)
      .catch((failure: unknown) => {
        if (!abort.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Company names could not load.",
          );
      });
    return () => abort.abort();
  }, [reload]);
  const change = (update: () => void) => {
    update();
    setPreview(null);
    setSaved(null);
    setError(null);
    setRequestId(crypto.randomUUID());
  };
  const source = catalog?.companies.find((c) => c.id === sourceId);
  const selected = catalog?.companies.find((c) => c.id === companyId);
  const proposal = CompanyAliasProposalSchema.safeParse({
    companyId,
    sourceCompanyId: sourceId === "other" ? null : sourceId,
    aliasName: source?.legalName ?? name,
  });
  const input = CompanyAliasReviewInputSchema.safeParse({
    ...(proposal.success ? proposal.data : {}),
    requestId,
    expectedRevision: preview?.revision,
    reason,
  });
  const options =
    catalog?.companies.map((company) => ({
      value: company.id,
      label: company.legalName,
      searchText: company.aliases?.join(" ") ?? "",
    })) ?? [];
  const submit = async () => {
    if (!proposal.success || working !== null) return;
    setError(null);
    try {
      if (preview === null) {
        setWorking("preview");
        setPreview(await previewCompanyAlias(proposal.data));
      } else if (input.success) {
        setWorking("save");
        const receipt = await reviewCompanyAlias(input.data);
        setSaved(receipt);
        setPreview(null);
        setSourceId("other");
        setName("");
        setReason("");
        setCatalog(await loadCompanyIdentities());
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Company names could not be saved.",
      );
    } finally {
      setWorking(null);
    }
  };
  return (
    <div className="company-names entity-review">
      <div className="entity-review__navigation">
        <TextLink href="/holdings/entities">Back to legal entities</TextLink>
      </div>
      <PageHeader
        title="Company names"
        description="Choose one company name for your holdings and recognize its other names in future reviews."
      />
      {publicExposureId !== null && publicExposureId.length > 0 && (
        <PublicCompanyLinkEditor exposureId={publicExposureId} />
      )}
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {catalog === null ? (
        <>
          <p role="status">Loading company names…</p>
          {error && (
            <Button
              onClick={() => {
                setError(null);
                setReload((value) => value + 1);
              }}
            >
              Retry company names
            </Button>
          )}
        </>
      ) : (
        <>
          {catalog.suggestedGroups.length > 0 && (
            <section
              className="company-names__suggestions"
              aria-label="Possible duplicates"
            >
              <SectionHeader
                title={`Possible duplicates · ${catalog.suggestedGroups.length}`}
                description="Similar names are suggestions. Confirm only names you know belong under the same company."
              />
              {catalog.suggestedGroups.slice(0, visibleGroups).map((ids) => {
                const companies = ids.map((id) =>
                  catalog.companies.find((c) => c.id === id)!,
                );
                return (
                  <div className="company-names__candidate" key={ids[0]}>
                    <p>
                      {companies
                        .slice(0, 4)
                        .map((c) => c.legalName)
                        .join(" · ")}
                      {companies.length > 4
                        ? ` · ${companies.length - 4} more names`
                        : ""}
                    </p>
                    <Button
                      tone="secondary"
                      disabled={working !== null}
                      onClick={() =>
                        change(() => {
                          setCompanyId(ids[0]!);
                          setSourceId(ids[1]!);
                          setName("");
                        })
                      }
                    >
                      Review names
                    </Button>
                  </div>
                );
              })}
              {catalog.suggestedGroups.length > visibleGroups && (
                <Button onClick={() => setVisibleGroups((count) => count + 20)}>
                  Show more possible duplicates
                </Button>
              )}
            </section>
          )}
          <section
            aria-label="Review company name"
            className="company-names__review"
          >
            <SectionHeader
              title="Review a company name"
              description="Choose the name to recognize and the company it should map to."
            />
            {saved && (
              <FormMessage tone="success">
                {saved.aliasName} now maps to {saved.companyName}.{" "}
                {saved.positions.length}{" "}
                {saved.positions.length === 1
                  ? "investment was"
                  : "investments were"}{" "}
                relinked.
              </FormMessage>
            )}
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <fieldset
                disabled={working !== null}
                className="company-names__fields"
              >
                <Field label="Name to recognize" variant="filled">
                  <SearchSelect
                    label="Name to recognize"
                    searchLabel="Search saved company names"
                    value={sourceId}
                    items={[
                      {
                        value: "other",
                        label: "Another name from an agreement",
                      },
                      ...options.filter((item) => item.value !== companyId),
                    ]}
                    onChange={(value) => change(() => setSourceId(value))}
                  />
                </Field>
                {sourceId === "other" && (
                  <Field label="Alternative company name" variant="filled">
                    <Input
                      value={name}
                      maxLength={1_000}
                      onChange={(event) =>
                        change(() => setName(event.currentTarget.value))
                      }
                    />
                  </Field>
                )}
                <Field label="Group under" variant="filled">
                  <SearchSelect
                    label="Group under"
                    searchLabel="Search companies"
                    value={companyId}
                    items={options.filter((item) => item.value !== sourceId)}
                    onChange={(value) => change(() => setCompanyId(value))}
                  />
                </Field>
              </fieldset>
              {selected && (selected.aliases?.length ?? 0) > 0 && (
                <p className="text-muted">
                  Already recognized:{" "}
                  {selected.aliases!.slice(0, 20).join("; ")}
                  {selected.aliases!.length > 20
                    ? `; and ${selected.aliases!.length - 20} more`
                    : ""}
                  .
                </p>
              )}
              {preview && (
                <div className="company-names__confirmation">
                  <h3>
                    {preview.aliasName} → {preview.companyName}
                  </h3>
                  <p>
                    {preview.positions.length}{" "}
                    {preview.positions.length === 1
                      ? "investment will"
                      : "investments will"}{" "}
                    move to this company grouping. Their legal vehicles, amounts
                    and agreement evidence stay unchanged.
                  </p>
                  {preview.aliases.length > 1 && (
                    <p>
                      The other {preview.aliases.length - 1} recognized{" "}
                      {preview.aliases.length === 2
                        ? "name moves"
                        : "names move"}{" "}
                      with this company.
                    </p>
                  )}
                  <p>
                    Future supported matches for this name will use{" "}
                    {preview.companyName}.
                  </p>
                  {preview.positions.length > 0 && (
                    <Collapsible className="entity-review__optional">
                      <CollapsibleTrigger>
                        Affected investments <DisclosureIndicator />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ul>
                          {preview.positions.slice(0, 50).map((position) => (
                            <li key={position.id}>{position.label}</li>
                          ))}
                        </ul>
                        {preview.positions.length > 50 && (
                          <p>
                            And {preview.positions.length - 50} more
                            investments.
                          </p>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                  <Field
                    label="Why these names belong together"
                    variant="filled"
                  >
                    <Textarea
                      value={reason}
                      maxLength={1_000}
                      disabled={working !== null}
                      onChange={(event) => {
                        setReason(event.currentTarget.value);
                        setRequestId(crypto.randomUUID());
                      }}
                    />
                  </Field>
                </div>
              )}
              <ActionGroup align="end">
                {preview !== null && (
                  <Button
                    type="button"
                    tone="secondary"
                    disabled={working !== null}
                    onClick={() => {
                      setPreview(null);
                      setRequestId(crypto.randomUUID());
                      setError(null);
                    }}
                  >
                    Review again
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={
                    working !== null ||
                    !proposal.success ||
                    sourceId === companyId ||
                    (preview !== null && !input.success)
                  }
                >
                  {working === "preview"
                    ? "Reviewing…"
                    : working === "save"
                      ? "Saving…"
                      : preview === null
                        ? "Review grouping"
                        : "Confirm company name"}
                </Button>
              </ActionGroup>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
