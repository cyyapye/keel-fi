import { useRef, useState } from "react";
import { Button, ButtonLink, Input, Notice } from "@keel/ui";
import { confirmWatchWebsite, findWatchWebsite } from "./api";

export function WatchWebsiteRecovery({
  targetId,
  companyName,
  canSearch,
  onSaved,
}: {
  targetId: string;
  companyName: string;
  canSearch: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [url, setUrl] = useState("");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<
    Awaited<ReturnType<typeof findWatchWebsite>>["candidates"] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const attempt = useRef({ input: "", id: "" });
  if (saved !== null)
    return (
      <div>
        <p role="status">
          {saved} confirmed. Verification is scheduled; monitoring begins after
          a successful check.
        </p>
        {error !== null && (
          <Notice tone="error">
            Website confirmed, but coverage could not be refreshed. Refresh the
            page to see its status.
          </Notice>
        )}
      </div>
    );
  return (
    <form
      className="watch-website-form"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const input = JSON.stringify([companyName, url, rationale]);
        if (attempt.current.input !== input)
          attempt.current = { input, id: crypto.randomUUID() };
        void confirmWatchWebsite(targetId, {
          decisionId: attempt.current.id,
          companyName,
          websiteUrl: url,
          rationale,
        })
          .then(async (receipt) => {
            setSaved(receipt.officialHost);
            await onSaved();
          })
          .catch((caught: unknown) =>
            setError(
              caught instanceof Error
                ? caught.message
                : "Couldn’t confirm the website.",
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <strong>Add an official website</strong>
      <p>
        Confirm that this website belongs to {companyName}. Keel will check
        whether it can read the site.
      </p>
      {canSearch && (
        <Button
          type="button"
          tone="quiet"
          disabled={searching || busy}
          onClick={() => {
            setSearching(true);
            setError(null);
            void findWatchWebsite(targetId)
              .then((result) => setCandidates(result.candidates))
              .catch((caught: unknown) =>
                setError(
                  caught instanceof Error
                    ? caught.message
                    : "Couldn’t find websites.",
                ),
              )
              .finally(() => setSearching(false));
          }}
        >
          {searching ? "Finding websites…" : "Find website"}
        </Button>
      )}
      {candidates !== null && (
        <div className="watch-website-candidates">
          <p>
            {candidates.length === 0
              ? "No matches found. Enter a known official website below."
              : "Search matches · Company identity is not confirmed"}
          </p>
          {candidates.map((candidate) => (
            <article key={candidate.url}>
              <ButtonLink
                href={candidate.url}
                tone="plain"
                target="_blank"
                rel="noreferrer"
              >
                {candidate.title}
              </ButtonLink>
              <small>{candidate.url}</small>
              <p>{candidate.description}</p>
              <Button
                type="button"
                tone="quiet"
                onClick={() => setUrl(candidate.url)}
              >
                Use this website
              </Button>
            </article>
          ))}
        </div>
      )}
      <label>
        Official website URL
        <Input
          type="url"
          required
          maxLength={2_000}
          placeholder="https://company.example/"
          value={url}
          disabled={busy}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <label>
        Why this is the same company
        <Input
          required
          minLength={8}
          maxLength={1_000}
          placeholder="Company name and identifying details on the site"
          value={rationale}
          disabled={busy}
          onChange={(event) => setRationale(event.target.value)}
        />
      </label>
      <Button
        type="submit"
        disabled={
          busy || rationale.trim().length < 8 || !url.startsWith("https://")
        }
      >
        {busy ? "Confirming…" : "Confirm website"}
      </Button>
      {error !== null && <Notice tone="error">{error}</Notice>}
    </form>
  );
}
