# Legal entity inventory polish

Approved in the implementation request on October 17, 2026: the revised
interactive legal-entities proposal, with the explicit exception that the
existing export workspace must remain unchanged.

## Meaning and scope

The ordinary task is finding a recorded legal vehicle, its company and owner,
and opening its existing details. The observed review queue occupied the first
screen and pushed the inventory below it. A company is an economic exposure; a
vehicle is a distinct legal record; an owner grouping is neither evidence of a
vehicle nor a reason to ask the owner to review themselves.

Keep a compact, initially closed exception disclosure and the inventory visible.
Search opens matching exceptions. Entity names open the existing details;
company names are always shown, preferring accepted company mappings. Unknown
optional jurisdiction and ownership interest stay in the editor instead of
repeating empty rows. Known values and conflicting earlier records remain
visible.

Owner containers without names, documents or policy exceptions remain in source
inventory and exports, but do not create triage tasks. Evidence-backed ownership
entities still qualify. This does not infer a person, trust, company or
ownership percentage from a name, and does not change acceptance policy.

Clear identity evidence already follows the automatic review policy. Company
labels alone cannot resolve an exact investment vehicle. Production records were
not recaptured or accepted as part of this presentation change.

## Interaction and verification

Reuse the existing details and editor as the sole editing owner. Opening an
entity, editing it and saving remains three activations where that editor
supports the ordinary path. Export fields, selection defaults, destinations and
failure behavior are unchanged. The mockup's export redesign was rejected.

Synthetic browser coverage checks collapsed triage, search discovery, owner-only
versus evidence-backed candidates, the existing 140-entity/500-source bounded
rendering cases, editing, failed saves and export selection. Desktop and mobile
screenshots cover the initial inventory and expanded review states. Existing
manual resolution tests open the disclosure explicitly after reload.

## Saved profile readback repair

The follow-up inspection found that standalone entity details showed only the
name, type and relationship even when the accepted profile contained more facts.
The requested repair reuses the existing read-only details and canonical editor;
it introduces no new task or editing owner. Display every recorded profile field
without entering edit mode, keep absent optional fields hidden, and preserve an
explicit zero ownership interest. The standalone header identifies the entity
once. Notes retain their line breaks and wrap within the available width.

The reading view uses the owner and ownership percentage as the primary answer,
with a smaller relationship description and quieter formation, tax and EIN
details. Spacing separates that summary, supporting facts and notes. Retain
wording that disambiguates a value only when its format and context cannot do
so. Show the jurisdiction and formation date together, the tax classification as
its value, and the EIN in its masked identifier format. Retain the EIN's meaning
for screen readers without repeating a visible field label. An LLC suffix
already states the entity type; other recorded structures remain explicit when
the name does not. Historical interest stays visible, while ordinary current
status is implicit. An absent owner or percentage must never imply a zero or an
ownership claim. The standalone entity name supplies the page identity; omit
duplicate eyebrows and section titles, and place its single edit action beside
that name.

When a legal vehicle is linked to an investment, distinguish earlier entity
ownership entries from dated position observations; do not present those profile
values as newly confirmed position observations.

Regression coverage must reject the former two-field detail view. Desktop and
mobile cases cover a complete profile, a sparse profile with zero interest,
unchanged-save prevention, changed-save readback after reload, and failed-save
draft retention followed by retry. Existing repository coverage verifies profile
version storage and stale-edit rejection. The export workspace remains
unchanged.

Typography assertions keep the entity name above the ownership answer and the
ownership answer above supporting text, and spacing assertions keep distinct
reading groups apart. Historical and incomplete cases cover a long owner name,
an explicit structure, one known formation field and no known ownership
percentage.
