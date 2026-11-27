/** Read-only walkthrough evidence. No product routes are followed by the catalogue. */
export const taskSourceRevision = "06e63a7ea70873dfecf1f4d701163dae3bd49b9c";
export type TaskStep = {
  id: string;
  title: string;
  route: string;
  source: string;
  owner: string;
  action: string;
  result: string;
  context: string;
  alternate: string;
};
export type TaskJourney = {
  id: string;
  title: string;
  areas: string[];
  steps: TaskStep[];
};
export const taskJourneys: TaskJourney[] = [
  {
    id: "planning",
    title: "How does a goal become a saved plan?",
    areas: ["overview", "goals", "scenarios", "forecasts"],
    steps: [
      {
        id: "planning-overview",
        title: "Overview",
        route: "/",
        source: "apps/web/src/App.tsx",
        owner:
          "Overview and Goals navigation; selectedGoalId / requestedGoalId are React state.",
        action:
          "Open a goal from Overview, or choose Goals from main navigation.",
        result:
          "The Goals workspace opens; choosing a saved goal loads its current form. Choosing a template starts a draft.",
        context:
          "The goal selection is in memory, not a goal ID URL or a guaranteed reload-restored selection.",
        alternate:
          "A new template is not an accepted goal. Missing goals require creating a draft; do not invent a saved version.",
      },
      {
        id: "planning-goal",
        title: "Goal draft & preview",
        route: "/goals",
        source: "apps/web/src/App.tsx",
        owner: "Goals chooseGoal, chooseTemplate, previewInput and submit.",
        action:
          "Review the synthetic goal draft and its forecast preview; provide a change note, then Save new version.",
        result:
          "Successful save records a goal version and matching forecast snapshot. This walkthrough does not save anything.",
        context:
          "Draft and preview belong to the selected goal form. A preview is not a saved version; the change note is required.",
        alternate:
          "Invalid fields or an empty note block save. A failed save shows an error rather than claiming a new version.",
      },
      {
        id: "planning-scenario",
        title: "Scenario comparison",
        route: "/scenarios",
        source: "apps/web/src/App.tsx",
        owner: "Scenarios draft, hasDraftChanges and save state.",
        action:
          "Manually choose Scenarios in main navigation. Edit assumptions, compare the draft, then Save scenario.",
        result:
          "The scenario is saved separately from the goal. Editing a draft alone does not replace accepted planning state.",
        context:
          "This is a manual route change, not a redirect after goal save. No goal-draft transfer or restored selection is asserted.",
        alternate:
          "Unsaved draft and saved scenario remain distinct. A failed scenario save retains an error; no successful version is implied.",
      },
      {
        id: "planning-history",
        title: "Forecast history",
        route: "/history",
        source: "apps/web/src/App.tsx",
        owner: "ForecastHistory saved version/trigger forecast list.",
        action:
          "Manually choose Forecast History in main navigation; inspect recorded versions and their forecasts.",
        result:
          "Read-only historical comparison of saved decisions. There is no restore or overwrite action in this walkthrough.",
        context:
          "History is a separate route, not an automatic redirect after saving a scenario. Saved snapshots are not live draft previews.",
        alternate:
          "If no snapshots exist, there is nothing to compare. Exact cross-route scroll and selection restoration are not verified.",
      },
    ],
  },
  {
    id: "evidence",
    title: "What can I decide about this Watch report?",
    areas: ["watch", "evidence", "scenarios"],
    steps: [
      {
        id: "evidence-watch",
        title: "Portfolio Watch",
        route: "/watch",
        source: "apps/web/src/App.tsx",
        owner:
          "PortfolioWatch joins the observation to its evidence event. WatchNewsRow opens that event.",
        action:
          "Choose Review decision on the financing report, or Details and View evidence on either update.",
        result:
          "The full Evidence Inbox opens and focuses the selected event, including after reloading its URL.",
        context:
          "The event ID identifies the report. The observation ID identifies the separate personal read receipt.",
        alternate:
          "Read news remains in All updates. An ordinary company update can be viewed without appearing in Decisions.",
      },
      {
        id: "evidence-review",
        title: "Selected report",
        route: "/evidence?event=evt_watch_harbor_series_c",
        source: "apps/web/src/App.tsx",
        owner:
          "EvidenceInbox focuses the matching card. EvidenceCard chooses actions from its claim and current status.",
        action:
          "Inspect the source and reported terms. Reject, choose Scenario only, or open Accept evidence to preview and confirm.",
        result:
          "Accepting the financing records reviewed company terms. A separate mapped financial report can also be applied to its named target.",
        context:
          "A company valuation has no holding impact calculation. Reviewing either report preserves the other report's status.",
        alternate:
          "Cancel closes the preview. Failed review stays in Evidence. An unavailable selected ID shows a notice alongside the remaining inbox.",
      },
      {
        id: "evidence-scenario",
        title: "Scenario context",
        route: "/scenarios",
        source: "apps/web/src/App.tsx",
        owner:
          "App records the scenario-only review, reloads data and passes the selected item to Scenarios.",
        action:
          "Choose Scenario only on the report, then inspect or dismiss its context in Scenarios.",
        result:
          "The evidence has a scenario-only review decision. Saving a scenario version requires a separate action.",
        context:
          "The banner belongs to the current app session. Reloading clears that context while the recorded review remains.",
        alternate:
          "A failed review stays in Evidence. Returning through normal navigation opens the inbox without an event selection.",
      },
    ],
  },
  {
    id: "obligations",
    title: "How should this obligation affect my runway?",
    areas: ["obligations"],
    steps: [
      {
        id: "obligations-proposal",
        title: "Obligation proposal",
        route: "/obligations",
        source: "apps/web/src/Obligations.tsx",
        owner:
          "Manual entry Continue to review and institution pendingProposals.",
        action:
          "Enter a manual obligation or inspect an institution proposal; Continue to review.",
        result:
          "A proposal awaits planning treatment. Reported debt is not automatically an immediate cash outflow.",
        context:
          "Proposal and review live in this workspace; this is not bill payment or money movement.",
        alternate:
          "Institution import needs its configured connection. Manual review remains separate; unavailable institution data is not a zero liability.",
      },
      {
        id: "obligations-review",
        title: "Review treatment",
        route: "/obligations",
        source: "apps/web/src/Obligations.tsx",
        owner:
          "Obligation review selections, paymentTreatment, changeNote and apply.",
        action:
          "Review the selected planning treatments and supply a review note before Apply review.",
        result:
          "Only selected payment treatments affect the accepted planning view. Review later exits without acceptance.",
        context:
          "The balance, next-payment amount and its treatment remain distinct. A required note records the review rationale.",
        alternate:
          "Empty note disables Apply review. Failed application shows an error; do not claim the proposal was accepted.",
      },
      {
        id: "obligations-impact",
        title: "Accepted planning impact",
        route: "/obligations",
        source: "apps/web/src/Obligations.tsx",
        owner: "state.impact and reviewed-obligations output after onApplied.",
        action:
          "Inspect reviewed obligations and their runway/liquidity treatment after successful application.",
        result:
          "Accepted planning context updates. No payment is submitted and not every outstanding dollar is reserved as cash.",
        context:
          "The result stays in Obligations. Moving to Overview or Scenarios is manual main navigation, not an implied redirect.",
        alternate:
          "Unreviewed proposals remain separate from reviewed obligations. A deferred review must not be presented as accepted.",
      },
    ],
  },
  {
    id: "source-updates",
    title: "What needs attention after a source update?",
    areas: ["holdings"],
    steps: [
      {
        id: "source-updates-sources",
        title: "Holding sources",
        route: "/holdings/sources",
        source: "apps/web/src/App.tsx",
        owner:
          "Holdings source/import route wiring and provider upload requestPreview.",
        action: "Inspect a source update and its routed import outcome.",
        result:
          "The outcome is addressed by /holdings/imports/:id. Eligible source rows can already have recorded deterministic policy decisions.",
        context:
          "The provider import flow is not the separate manual checkbox composition. Reference links do not upload or fetch any file.",
        alternate:
          "A failed preview is not an accepted update. Missing values remain unknown; absence from a partial private template is not a sale.",
      },
      {
        id: "source-updates-outcome",
        title: "Policy outcome & exceptions",
        route: "/holdings/imports/demo-import",
        source: "apps/web/src/HoldingImportOutcome.tsx",
        owner:
          "decisionSource, autoAppliedCount, ignoredCount and exception-only resolve.",
        action:
          "Read automatic/unchanged/older-skipped results. Review only rows without a policy decision; confirm legal position and owner before accepting an exception.",
        result:
          "Already-applied rows need no second Apply. Apply selected exceptions and dismiss the rest, or Dismiss exceptions, preserves prior holdings for dismissed rows.",
        context:
          "Routine source policy is documented in docs/architecture/source-update-policy.md. Identity cannot be established by ticker, name or equal value alone.",
        alternate:
          "Review later leaves exceptions unresolved. A resolution failure shows an error; the source policy has idempotent retries. No separate Check status control is claimed for this product screen.",
      },
      {
        id: "source-updates-entities",
        title: "Legal entity context",
        route: "/holdings/entities",
        source: "apps/web/src/LegalEntities.tsx",
        owner:
          "SavedEntityProfile, legal entity workspace; holdings subnavigation in app-navigation.ts.",
        action:
          "Manually choose Legal entities in Holdings subnavigation when ownership context needs inspection.",
        result:
          "Inspect the legal vehicle and ownership profile without combining distinct vehicles that invest in the same company.",
        context:
          "This is a manual navigation edge, not the outcome screen\u2019s Back to holdings action. No import-selected entity or scroll restoration is asserted.",
        alternate:
          "Invalid source rows need a corrected import. Masked identity details remain masked; the reference contains no real identifier or source document.",
      },
    ],
  },
  {
    id: "app-access",
    title: "What can a connected app access?",
    areas: ["settings"],
    steps: [
      {
        id: "app-access-settings",
        title: "App access",
        route: "/settings",
        source: "apps/web/src/AppAccess.tsx",
        owner: "Connected apps / API keys tabs and grant list.",
        action:
          "Inspect connected apps or API-key access in Settings. For OAuth, connection starts from the requesting app.",
        result:
          "Existing grants show permissions and access lifetime. A new request arrives at /oauth/authorize; switching models does not require a new connection.",
        context:
          "This reference is a read-only walkthrough. It never starts OAuth, opens an external app, generates a credential or copies anything.",
        alternate:
          "Loading or failed access data is not an empty grant list. Expired and revoked access are distinct from active access.",
      },
      {
        id: "app-access-consent",
        title: "Requested scope & expiry",
        route: "/oauth/authorize",
        source: "apps/web/src/AppAccess.tsx",
        owner:
          "incoming context, requestedPermissions maximum, durationDays and authorization receipt.",
        action:
          "In the product, inspect the requesting app, choose permitted areas and lifetime, then authorize only the intended scope.",
        result:
          "Successful authorization creates the scoped grant and redirects to the requesting app. This walkthrough neither authorizes nor redirects.",
        context:
          "The authorization request is external route context, not a Settings tab. At least one area is required, within requested maximum permissions.",
        alternate:
          "Invalid or failed requests do not grant access. No realistic request token, callback URL, secret or credential is shown here.",
      },
      {
        id: "app-access-lifecycle",
        title: "Grant & key lifecycle",
        route: "/settings",
        source: "apps/web/src/AppAccess.tsx",
        owner:
          "Grant permissions/expiry, rename, revoke confirmation and key rotation.",
        action:
          "Manually return to Settings to inspect, change or revoke access. Key creation/rotation is a separate product lifecycle, not an OAuth step.",
        result:
          "Revocation ends the chosen grant. Key rotation preserves permissions and access expiry; it does not silently broaden scope.",
        context:
          "The catalogue describes the lifecycle only. There is no functional grant/revoke button, clipboard operation or generated key, even a realistic fake one.",
        alternate:
          "A failed mutation is not a successful revoke. Product key receipts are one-time disclosures; this reference never renders their values.",
      },
    ],
  },
];
