export function formatWatchTime(value: string | null): string {
  return value === null
    ? "Not checked yet"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(value));
}

export function nextWatchAttempt(
  eligibleAt: string | null,
  asOf: string,
): string | null {
  if (eligibleAt === null) return null;
  const eligible = new Date(Math.max(Date.parse(eligibleAt), Date.parse(asOf)));
  const scheduled = new Date(eligible);
  scheduled.setUTCHours(13, 0, 0, 0);
  if (scheduled < eligible) scheduled.setUTCDate(scheduled.getUTCDate() + 1);
  return scheduled.toISOString();
}

export function watchSourceProblem(
  code: string | null,
  httpStatus: number | null = null,
): string {
  if (code === null) return "Source is not ready for monitoring.";
  if (
    code === "non_success_status" &&
    (httpStatus === 401 || httpStatus === 403)
  )
    return "The website denied access to this page.";
  if (
    code === "non_success_status" &&
    (httpStatus === 404 || httpStatus === 410)
  )
    return "This page is no longer available at this address.";
  if (code === "non_success_status" && httpStatus === 429)
    return "The website is limiting requests. Keel will retry later.";
  if (/timeout|network|fetch_failed|dns|http_5/.test(code))
    return "The site did not respond. Keel will retry.";
  if (/identity/.test(code)) return "Company identity could not be confirmed.";
  if (/redirect|host|origin|private|ip_|url|security/.test(code))
    return "The source no longer matches its approved website.";
  if (/malformed|content_type|media_type|response.*large|byte/.test(code))
    return "Keel couldn’t read this page’s format.";
  if (code === "check_timed_out")
    return "This check did not finish. Check again to retry.";
  if (/processing/.test(code))
    return "Keel couldn’t finish reading and saving this source. Check again to retry.";
  if (/not_monitored|not_ready/.test(code))
    return "This source is no longer ready for monitoring.";
  return "The source could not be checked. Keel will retry eligible sources.";
}
import type { PublicSourceObservation } from "@keel/domain";

export function watchUpdatesForReview(
  observations: readonly PublicSourceObservation[],
  query: string,
  supersededIds: ReadonlySet<string>,
) {
  const search = query.trim().toLowerCase();
  return observations
    .filter((item) => item.companyName.toLowerCase().includes(search))
    .map((observation) => ({
      observation,
      needsReview:
        observation.evidenceStatus === "pending_review" &&
        !supersededIds.has(observation.id),
    }))
    .sort(
      (left, right) =>
        Number(right.needsReview) - Number(left.needsReview) ||
        Date.parse(right.observation.retrievedAt) -
          Date.parse(left.observation.retrievedAt) ||
        right.observation.id.localeCompare(left.observation.id),
    );
}
