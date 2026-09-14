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

export function watchSourceProblem(code: string | null): string {
  if (code === null) return "Source is not ready for monitoring.";
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
