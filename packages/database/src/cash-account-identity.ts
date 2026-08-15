export type AcceptedCashAccountHistoryRow = {
  decision_id: string;
  proposal_id: string;
  natural_key_sha256: string;
  item_account_key_sha256: string | null;
  connector_account_id: string;
  institution_label: string;
  account_label: string;
  subtype:
    "checking" | "savings" | "money market" | "cash management" | "other";
  value_minor: number | null;
  value_state: "reported" | "not_reported";
  balance_source: "available" | "current" | null;
  refresh_kind: "initial" | "live";
  observed_at: string;
  decided_at: string;
};

type CashAccountIdentityObservation = {
  readonly connectorAccountId: string;
  readonly naturalKeySha256: string;
  readonly itemAccountKeySha256: string;
};

export type CashAccountIdentityLink = {
  readonly connectorAccountId: string;
  readonly naturalKeyLowSha256: string;
  readonly naturalKeyHighSha256: string;
};

type CashAccountIdentityProjection<Row extends AcceptedCashAccountHistoryRow> =
  {
    readonly acceptedRows: readonly {
      readonly canonicalNaturalKeySha256: string;
      readonly row: Row;
    }[];
    canonicalNaturalKeyForNatural(
      connectorAccountId: string,
      naturalKeySha256: string,
    ): string;
    canonicalNaturalKeyFor(
      connectorAccountId: string,
      naturalKeySha256: string,
      itemAccountKeySha256: string,
    ): string;
  };

function identityNode(
  connectorAccountId: string,
  kind: "item" | "natural",
  key: string,
): string {
  return JSON.stringify([connectorAccountId, kind, key]);
}

function acceptedRowIsLater(
  candidate: AcceptedCashAccountHistoryRow,
  current: AcceptedCashAccountHistoryRow,
) {
  const decidedComparison = candidate.decided_at.localeCompare(
    current.decided_at,
  );
  if (decidedComparison !== 0) {
    return decidedComparison > 0;
  }
  const observedComparison = candidate.observed_at.localeCompare(
    current.observed_at,
  );
  if (observedComparison !== 0) {
    return observedComparison > 0;
  }
  if (candidate.value_state !== current.value_state) {
    return candidate.value_state === "reported";
  }
  if (
    (candidate.item_account_key_sha256 === null) !==
    (current.item_account_key_sha256 === null)
  ) {
    return candidate.item_account_key_sha256 !== null;
  }
  return candidate.decision_id.localeCompare(current.decision_id) > 0;
}

export function projectCashAccountIdentities<
  Row extends AcceptedCashAccountHistoryRow,
>(
  rows: readonly Row[],
  observations: readonly CashAccountIdentityObservation[] = [],
  links: readonly CashAccountIdentityLink[] = [],
): CashAccountIdentityProjection<Row> {
  const parents = new Map<string, string>();
  const ensure = (node: string) => {
    if (!parents.has(node)) {
      parents.set(node, node);
    }
  };
  const find = (node: string): string => {
    ensure(node);
    const parent = parents.get(node);
    if (parent === undefined || parent === node) {
      return node;
    }
    const root = find(parent);
    parents.set(node, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) {
      return;
    }
    if (leftRoot.localeCompare(rightRoot) <= 0) {
      parents.set(rightRoot, leftRoot);
    } else {
      parents.set(leftRoot, rightRoot);
    }
  };
  const connect = (
    connectorAccountId: string,
    naturalKeySha256: string,
    itemAccountKeySha256: string | null,
  ) => {
    const naturalNode = identityNode(
      connectorAccountId,
      "natural",
      naturalKeySha256,
    );
    ensure(naturalNode);
    if (itemAccountKeySha256 !== null) {
      union(
        naturalNode,
        identityNode(connectorAccountId, "item", itemAccountKeySha256),
      );
    }
  };

  rows.forEach((row) => {
    connect(
      row.connector_account_id,
      row.natural_key_sha256,
      row.item_account_key_sha256,
    );
    if (
      row.item_account_key_sha256 === null &&
      row.value_state !== "not_reported"
    ) {
      // Before Item-scoped keys were retained, the natural key was derived
      // from Plaid's account_id. Bridge that legacy key into the Item namespace
      // so a later persistent_account_id can continue the same lineage.
      union(
        identityNode(
          row.connector_account_id,
          "natural",
          row.natural_key_sha256,
        ),
        identityNode(row.connector_account_id, "item", row.natural_key_sha256),
      );
    }
  });
  observations.forEach((observation) =>
    connect(
      observation.connectorAccountId,
      observation.naturalKeySha256,
      observation.itemAccountKeySha256,
    ),
  );
  links.forEach((link) =>
    union(
      identityNode(
        link.connectorAccountId,
        "natural",
        link.naturalKeyLowSha256,
      ),
      identityNode(
        link.connectorAccountId,
        "natural",
        link.naturalKeyHighSha256,
      ),
    ),
  );

  const canonicalCandidateByRoot = new Map<
    string,
    { acceptedAt: string | null; naturalKeySha256: string }
  >();
  const considerCanonical = (
    connectorAccountId: string,
    naturalKeySha256: string,
    acceptedAt: string | null,
  ) => {
    const root = find(
      identityNode(connectorAccountId, "natural", naturalKeySha256),
    );
    const current = canonicalCandidateByRoot.get(root);
    if (
      current === undefined ||
      (current.acceptedAt === null && acceptedAt !== null) ||
      (current.acceptedAt !== null &&
        acceptedAt !== null &&
        (acceptedAt.localeCompare(current.acceptedAt) < 0 ||
          (acceptedAt === current.acceptedAt &&
            naturalKeySha256.localeCompare(current.naturalKeySha256) < 0))) ||
      (current.acceptedAt === null &&
        acceptedAt === null &&
        naturalKeySha256.localeCompare(current.naturalKeySha256) < 0)
    ) {
      canonicalCandidateByRoot.set(root, {
        acceptedAt,
        naturalKeySha256,
      });
    }
  };
  rows.forEach((row) =>
    considerCanonical(
      row.connector_account_id,
      row.natural_key_sha256,
      row.decided_at,
    ),
  );
  observations.forEach((observation) =>
    considerCanonical(
      observation.connectorAccountId,
      observation.naturalKeySha256,
      null,
    ),
  );

  const canonicalNaturalKeyForNatural = (
    connectorAccountId: string,
    naturalKeySha256: string,
  ) => {
    const root = find(
      identityNode(connectorAccountId, "natural", naturalKeySha256),
    );
    return (
      canonicalCandidateByRoot.get(root)?.naturalKeySha256 ?? naturalKeySha256
    );
  };

  const canonicalNaturalKeyFor = (
    connectorAccountId: string,
    naturalKeySha256: string,
    itemAccountKeySha256: string,
  ) => {
    const root = find(
      identityNode(connectorAccountId, "natural", naturalKeySha256),
    );
    const itemRoot = find(
      identityNode(connectorAccountId, "item", itemAccountKeySha256),
    );
    if (root !== itemRoot) {
      return naturalKeySha256;
    }
    return (
      canonicalCandidateByRoot.get(root)?.naturalKeySha256 ?? naturalKeySha256
    );
  };

  const latestByCanonicalKey = new Map<
    string,
    { canonicalNaturalKeySha256: string; row: Row }
  >();
  rows.forEach((row) => {
    const root = find(
      identityNode(row.connector_account_id, "natural", row.natural_key_sha256),
    );
    const canonicalNaturalKeySha256 =
      canonicalCandidateByRoot.get(root)?.naturalKeySha256 ??
      row.natural_key_sha256;
    const scopedCanonicalKey = identityNode(
      row.connector_account_id,
      "natural",
      canonicalNaturalKeySha256,
    );
    const current = latestByCanonicalKey.get(scopedCanonicalKey);
    if (current === undefined || acceptedRowIsLater(row, current.row)) {
      latestByCanonicalKey.set(scopedCanonicalKey, {
        canonicalNaturalKeySha256,
        row,
      });
    }
  });

  const acceptedRows = [...latestByCanonicalKey.values()].sort(
    (left, right) =>
      left.row.institution_label.localeCompare(right.row.institution_label) ||
      left.row.account_label.localeCompare(right.row.account_label) ||
      left.canonicalNaturalKeySha256.localeCompare(
        right.canonicalNaturalKeySha256,
      ),
  );

  return {
    acceptedRows,
    canonicalNaturalKeyForNatural,
    canonicalNaturalKeyFor,
  };
}
