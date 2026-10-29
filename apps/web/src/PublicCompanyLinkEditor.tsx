import { useEffect, useState, useRef } from "react";
import {
  PublicCompanyLinkReviewSchema,
  type PublicCompanyLinkCatalog,
  type PublicCompanyLinkReview,
  type PublicCompanyMatch,
} from "@keel/domain/public-company-links";
import {
  Button,
  Field,
  FormMessage,
  Input,
  SearchSelect,
  SectionHeader,
  PageHeader,
  Textarea,
  TextLink,
} from "@keel/ui";
import {
  loadPublicCompanyLinks,
  reviewPublicCompanyLink,
  recommendPublicCompanyLink,
  approvePublicCompanyRecommendation,
} from "./api";

function ManualPublicCompanyLinkEditor({
  exposureId,
  onSaved,
}: {
  exposureId: string;
  onSaved: () => void;
}) {
  const [catalog, setCatalog] = useState<PublicCompanyLinkCatalog | null>(null);
  const selectedExposureId = exposureId;
  const [companyId, setCompanyId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<PublicCompanyLinkReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    void loadPublicCompanyLinks(abort.signal)
      .then((result) => {
        setCatalog(result);
        const selected = result.securities.find(
          (security) => security.exposureId === exposureId,
        );
        setCompanyId(selected?.companyId ?? "");
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Public holdings could not load.",
          );
      });
    return () => abort.abort();
  }, [exposureId]);

  const security = catalog?.securities.find(
    (item) => item.exposureId === selectedExposureId,
  );
  const company = catalog?.companies.find((item) => item.id === companyId);
  const draft = PublicCompanyLinkReviewSchema.safeParse({
    exposureId: selectedExposureId,
    companyId,
    expectedReviewId: security?.reviewId ?? null,
    sourceUrl,
    reason,
  });
  const change = (update: () => void) => {
    update();
    setPreview(null);
    setSaved(false);
    setError(null);
  };
  const submit = async () => {
    if (
      !draft.success ||
      security === undefined ||
      company === undefined ||
      busy
    )
      return;
    if (preview === null) {
      setPreview(draft.data);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reviewPublicCompanyLink(preview);
      const next = await loadPublicCompanyLinks();
      setCatalog(next);
      setPreview(null);
      setSaved(true);
      setSourceUrl("");
      setReason("");
      onSaved();
    } catch (failure) {
      setPreview(null);
      setError(
        failure instanceof Error
          ? failure.message
          : "The company link could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="company-names__review" aria-label="Link public holding">
      <SectionHeader
        title="Choose another company"
        description="Add the source that confirms this issuer belongs to the company."
      />
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {saved && (
        <FormMessage tone="success">
          This security now appears with the company’s other positions.
        </FormMessage>
      )}
      {catalog === null ? (
        <p role="status">Loading public holdings…</p>
      ) : security === undefined ? (
        <p>This public holding is no longer available for review.</p>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy} className="company-names__fields">
            <Field label="Group under" variant="filled">
              <SearchSelect
                label="Group under"
                searchLabel="Search companies"
                value={companyId}
                items={catalog.companies.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                onChange={(value) => change(() => setCompanyId(value))}
              />
            </Field>
            <Field label="Issuer evidence URL" variant="filled">
              <Input
                type="url"
                value={sourceUrl}
                onChange={(event) =>
                  change(() => setSourceUrl(event.currentTarget.value))
                }
              />
            </Field>
            <Field
              label="Why this security belongs to this company"
              variant="filled"
            >
              <Textarea
                value={reason}
                maxLength={1_000}
                onChange={(event) =>
                  change(() => setReason(event.currentTarget.value))
                }
              />
            </Field>
          </fieldset>
          {preview && (
            <div className="company-names__confirmation">
              <h3>
                {security.name} → {company?.name}
              </h3>
              <p>
                {security.positionCount}{" "}
                {security.positionCount === 1 ? "position" : "positions"} will
                appear with this company. Position values and source details
                stay unchanged.
              </p>
              <TextLink
                href={preview.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                View issuer evidence
              </TextLink>
            </div>
          )}
          <Button
            disabled={!draft.success || company === undefined || busy}
            type="submit"
          >
            {busy
              ? "Saving…"
              : preview === null
                ? "Review grouping"
                : "Confirm company link"}
          </Button>
        </form>
      )}
    </section>
  );
}

export function PublicCompanyLinkEditor({
  exposureId,
  returnPositionId,
}: {
  exposureId: string;
  returnPositionId?: string;
}) {
  const returnHref = returnPositionId
    ? `/holdings?position=${encodeURIComponent(returnPositionId)}`
    : "/holdings";
  const [catalog, setCatalog] = useState<PublicCompanyLinkCatalog | null>(null);
  const [match, setMatch] = useState<PublicCompanyMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState(false);
  const initial = useRef<Promise<PublicCompanyLinkCatalog> | null>(null);
  const lookup = useRef<Promise<PublicCompanyMatch> | null>(null);
  useEffect(() => {
    let active = true;
    initial.current ??= loadPublicCompanyLinks();
    void initial.current
      .then(async (result) => {
        if (!active) return;
        setCatalog(result);
        const security = result.securities.find(
          (item) => item.exposureId === exposureId,
        );
        if (security && security.companyId === null) {
          lookup.current ??= recommendPublicCompanyLink(exposureId);
          const recommendation = await lookup.current;
          if (active) setMatch(recommendation);
        }
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Couldn’t check the issuer match.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [exposureId]);
  const security = catalog?.securities.find(
    (item) => item.exposureId === exposureId,
  );
  const linked = catalog?.companies.find(
    (item) => item.id === security?.companyId,
  );
  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadPublicCompanyLinks();
      setCatalog(next);
      setMatch(await recommendPublicCompanyLink(exposureId));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Couldn’t check the issuer match.",
      );
    } finally {
      setLoading(false);
    }
  };
  const approve = async () => {
    if (match?.status !== "recommended" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const receipt = await approvePublicCompanyRecommendation(match.id);
      setCatalog((current) =>
        current === null
          ? null
          : {
              ...current,
              securities: current.securities.map((item) =>
                item.exposureId === exposureId
                  ? {
                      ...item,
                      companyId: receipt.companyId,
                      reviewId: receipt.id,
                    }
                  : item,
              ),
            },
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The grouping could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="company-names entity-review"
      aria-label="Review company grouping"
    >
      <div className="entity-review__navigation">
        <TextLink href={returnHref}>
          {returnPositionId ? "Back to position" : "Back to holdings"}
        </TextLink>
      </div>
      <PageHeader
        title="Company grouping"
        description={
          security?.name ?? "Find the company behind this public holding."
        }
      />
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {loading ? (
        <p role="status">Checking issuer evidence…</p>
      ) : catalog === null ? (
        <Button onClick={() => void refresh()} tone="secondary">
          Try again
        </Button>
      ) : security === undefined ? (
        <p>This public holding is no longer available.</p>
      ) : manual ? (
        <>
          <ManualPublicCompanyLinkEditor
            exposureId={exposureId}
            onSaved={() => {
              setManual(false);
              void refresh();
            }}
          />
          <Button tone="quiet" onClick={() => setManual(false)}>
            Back to recommendation
          </Button>
        </>
      ) : linked ? (
        <section className="company-names__review">
          <SectionHeader
            title={`Grouped with ${linked.name}`}
            description="This holding now appears with the company’s other positions."
          />
          <TextLink href={returnHref}>
            {returnPositionId ? "View position" : "View holdings"}
          </TextLink>
          <Button tone="quiet" onClick={() => setManual(true)}>
            Change company
          </Button>
        </section>
      ) : (
        <section className="company-names__review">
          {match?.status === "recommended" ? (
            <>
              <SectionHeader
                eyebrow="Recommended company"
                title={match.companyName!}
                description={match.reason}
              />
              {match.sourceUrl ? (
                <TextLink
                  href={match.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {match.sourceTitle ?? "View issuer evidence"}
                </TextLink>
              ) : (
                <TextLink href="/holdings/entities?companies=1">
                  View accepted company names
                </TextLink>
              )}
              <p>
                {security.positionCount === 1
                  ? "This position will appear"
                  : `${security.positionCount} positions will appear`}{" "}
                with {match.companyName}’s other holdings. Each position keeps
                its own value.
              </p>
              <Button onClick={() => void approve()} disabled={busy}>
                {busy ? "Saving…" : "Approve grouping"}
              </Button>
            </>
          ) : (
            <SectionHeader
              title={
                match?.status === "ambiguous"
                  ? "Match needs clarification"
                  : match?.status === "unavailable"
                    ? "Issuer lookup unavailable"
                    : match?.status === "pending"
                      ? "Checking issuer evidence"
                      : "No confident match yet"
              }
              description={match?.reason}
            />
          )}
          {(error !== null || match?.status === "pending") && (
            <Button tone="secondary" onClick={() => void refresh()}>
              Check again
            </Button>
          )}
          <Button tone="quiet" onClick={() => setManual(true)}>
            {match?.status === "recommended"
              ? "Change company"
              : "Choose company manually"}
          </Button>
        </section>
      )}
    </div>
  );
}
