# Manual holdings v1

Dedicated editor v1 adds a private investment from Holdings or its empty state.
One Save records the declaration and opens the regular holding detail. The
supported investment currency is USD, with Direct, SPV and Fund kinds. The
explicit planning classification is private paper; creation makes no claim that
the investment is liquid or eligible for FI spending.

The declaration requires a legal investment name, kind and owner. Company
grouping is optional and uses an explicit existing company selection. Names do
not merge investments, companies or separate legal SPVs. Manual owners belong to
a genuine manual source, separate from provider-managed and template-import
connections even when those adapters use the word manual internally.

For a Fund, Company records a known underlying company while its allocation
remains unknown. The fund's whole value is not assigned to that company. Later
identity edits explicitly preserve current groupings that cannot be represented
by the single-company selector; they do not silently unassign them.

Cash paid, investment date and a dated estimate are optional. A blank amount is
unknown, while an entered zero is a known zero. Commitment, distributions, fees,
net capital and shares remain unknown until supported by their canonical
editors. A synthetic example with $25,000 paid and a $30,000 estimate therefore
shows those facts separately without asserting a 20% return. The estimate uses
the valuation judgment receipt, its effective date and carry treatment; it does
not become provider NAV. Source capture time is separate from effective date.

The detail identifies the source as Entered by you and explains that it is not
provider verified. Investment, Valuation and History retain their existing
owners. Later name, kind, owner and grouping changes append identity revisions;
they do not update immutable accepted positions or create another money ledger.
Identity saves compare the prior identity version and complete current company
mapping set. Investment dates are subsequently edited through Investment. The
regular chronological History shows creation and identity corrections with
prior/new names, kinds, owners and actual company changes. The initial identity
and investment receipt are one creation activity. History pages contain at most
30 activities, use one D1 round trip, read at most 1,000 rows in the manual
history holdout, and write nothing. Effective dates remain distinct from the
time an activity was recorded.

Every save retains a stable submission UUID. An exact replay returns the saved
receipt; a changed declaration under that UUID conflicts. A failed response
keeps the draft and UUID, including across reload. Check saved holding reads the
household-scoped submission projection before a same-key retry becomes
available. A known stale identity draft must be reopened against current facts.

The private JSON evidence is content addressed. D1 atomically accepts the source
observation, human decision, ownership, financial snapshot/application, initial
purchase receipt, identity and submission receipt. The object may precede the
transaction; an unsuccessful transaction never leaves an accepted partial
holding. GET options, submission checks and Holdings use projections without
provider calls, object reads or writes. Existing accepted baselines are
retained; planning follows the existing explicit review policy.

Regression assertions cover all three kinds, unknown versus zero, optional dates
and values, dated valuation edits, canonical investment edits, identity and
company mapping races, household isolation, exact and conflicting retries,
rollback, same-company separate SPVs, explicit overlap histories, source and
receipt provenance, and preserved baseline history. Native browser cases create,
reload and edit synthetic D1 records on desktop and mobile. Mocked browser cases
exercise invalid, saving, rejected, unconfirmed and no-match recovery.

The real-D1 read holdout uses 120 manual positions and 120 tied revisions per
position, including owner, source, identity and company mapping histories. The
combined options and position projection budget is five D1 round trips, seven
statements, 6,000 rows read and zero writes; historical growth adds at most
2,000 rows read and 120 unrelated positions add at most 100. Empty-household
reads have the same fixed round-trip budget and remain independent of unrelated
history. Query plans must use current mapping heads and indexed latest metadata
seeks. Existing 120-by-120 source snapshot history limits remain unchanged. D1
costs include integrity triggers and index maintenance rather than inferred row
or statement counts.

The synthetic native D1 run measured 16,888 rows read and 12,506 rows written
for 120 accepted creations across 960 round trips. Combined options/position
reads used 5,172 rows both before and after tied history growth, 5,178 after
adding 120 unrelated positions, and nine for an empty household. A full manual
identity-history page read 389 rows; its foreign-scope result read 11 rows and
remained unchanged through history and unrelated growth. That new foreign
history budget is 16 rows, aligned with the established history holdout; the
existing purchase-history budgets remain unchanged.
