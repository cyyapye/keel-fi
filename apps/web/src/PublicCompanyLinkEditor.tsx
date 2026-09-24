import { useEffect, useState } from "react";
import {
  PublicCompanyLinkReviewSchema,
  type PublicCompanyLinkCatalog,
  type PublicCompanyLinkReview,
} from "@keel/domain/public-company-links";
import {
  Button,
  Field,
  FormMessage,
  Input,
  SearchSelect,
  SectionHeader,
  Textarea,
  TextLink,
} from "@keel/ui";
import { loadPublicCompanyLinks, reviewPublicCompanyLink } from "./api";

export function PublicCompanyLinkEditor({
  exposureId,
}: {
  exposureId: string;
}) {
  const [catalog, setCatalog] = useState<PublicCompanyLinkCatalog | null>(null);
  const [selectedExposureId, setSelectedExposureId] = useState(exposureId);
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
        title="Link a public holding"
        description="Choose the company that issued this security. Its position and value stay unchanged."
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
            <Field label="Public security" variant="filled">
              <SearchSelect
                label="Public security"
                searchLabel="Search public securities"
                value={selectedExposureId}
                items={catalog.securities.map((item) => ({
                  value: item.exposureId,
                  label: item.name,
                }))}
                onChange={(value) =>
                  change(() => {
                    setSelectedExposureId(value);
                    setCompanyId(
                      catalog.securities.find(
                        (item) => item.exposureId === value,
                      )?.companyId ?? "",
                    );
                  })
                }
              />
            </Field>
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
