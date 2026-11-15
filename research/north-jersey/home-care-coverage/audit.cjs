async function audit() {
  const [
    { default: assert },
    { createHash },
    { readFileSync, writeFileSync },
    { resolve, join },
    { require: load },
  ] = await Promise.all([
    import("node:assert/strict"),
    import("node:crypto"),
    import("node:fs"),
    import("node:path"),
    import("tsx/cjs/api"),
  ]);
  const root = resolve(__dirname, "../../..");
  process.chdir(root);
  const { markets } = load(join(root, "src/lib/markets.ts"), __filename);
  const { getLocationResearch } = load(
    join(root, "src/lib/location-research.ts"),
    __filename,
  );
  const { publicLocationResearch } = load(
    join(root, "src/lib/public-location-research.ts"),
    __filename,
  );
  const { getReviewCatalog, getExternalReviewProfiles } = load(
    join(root, "src/lib/review-catalog.ts"),
    __filename,
  );
  const { individualReviews, reviewAccountCounts } = load(
    join(root, "src/lib/individual-reviews.ts"),
    __filename,
  );
  const { computeExperienceScore } = load(
    join(root, "src/lib/experience-score.ts"),
    __filename,
  );
  const { getHomeCareOfficeIdentifiers } = load(
    join(root, "src/lib/home-care-office-identifiers.ts"),
    __filename,
  );

  const dimensions = [
    "services",
    "accreditations",
    "payments",
    "insurance",
    "historicalInsuranceDirectories",
    "otherFacts",
  ];
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  const sorted = (values) => [...new Set(values)].sort();
  const entries = (value) =>
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  const fraction = (numerator, denominator) => ({ numerator, denominator });
  const syntheticId = (kind, url) =>
    `${kind}-${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
  const relationships = ["family", "resident", "staff", "visitor", "unknown"];
  const accountMetrics = [
    "individualReviews",
    "readableIndividualReviews",
    "unratedIndividualReviews",
    "unratedReadableIndividualReviews",
    "eligibleReadableReviews",
    "unscoredWithEligibleReadableReviews",
  ];
  const aggregateMetrics = [
    "scoredAggregates",
    "scoredAggregateReportedReviews",
    "eligibleAggregates",
    "aggregateReportedReviews",
  ];

  function eligibleReadable(account, sourceIds) {
    return Boolean(
      (account.excerpt?.trim() || account.summary?.trim()) &&
      account.representation !== "link-only" &&
      !account.providerSelected &&
      !account.searchResultOnly &&
      account.relationship !== "staff" &&
      sourceIds.has(account.sourceId),
    );
  }

  function relationshipCounts(items) {
    return Object.fromEntries(
      relationships.map((key) => [
        key,
        sum(items.map((item) => item.eligibleReadableRelationships[key])),
      ]),
    );
  }

  function accountRecord(selected, sourceIds) {
    const counts = reviewAccountCounts(selected);
    const unrated = selected.filter((account) => account.rating === null);
    const eligible = selected.filter((account) =>
      eligibleReadable(account, sourceIds),
    );
    return {
      total: counts.total,
      withText: counts.withText,
      unrated: unrated.length,
      unratedWithText: reviewAccountCounts(unrated).withText,
      eligibleReadable: eligible.length,
      eligibleReadableRelationships: Object.fromEntries(
        relationships.map((key) => [
          key,
          eligible.filter((account) => account.relationship === key).length,
        ]),
      ),
      originalSummaries: selected.filter(
        (account) =>
          account.representation === "original-summary" &&
          account.summary.trim(),
      ).length,
    };
  }

  function aggregateSummary(records, matches = () => true) {
    const selected = records.flatMap((r) =>
      r.aggregates.filter((s) => matches(r, s)),
    );
    const scored = records
      .filter((r) => r.score !== null)
      .flatMap((r) => r.aggregates.filter((s) => matches(r, s)));
    return {
      scoredProviders: fraction(
        records.filter(
          (r) => r.score !== null && r.aggregates.some((s) => matches(r, s)),
        ).length,
        records.length,
      ),
      eligibleAggregateProviders: fraction(
        records.filter((r) => r.aggregates.some((s) => matches(r, s))).length,
        records.length,
      ),
      scoredAggregates: scored.length,
      scoredAggregateReportedReviews: sum(scored.map((s) => s.count)),
      eligibleAggregates: selected.length,
      aggregateReportedReviews: sum(selected.map((s) => s.count)),
    };
  }

  function classification(record) {
    const substantive =
      record.sourceIds.some((id) => !record.registrySourceIds.includes(id)) ||
      record.externalProfileCount > 0;
    return substantive
      ? "research"
      : record.registrySourceIds.length
        ? "registry-only"
        : "no-research";
  }

  function providerRecord(
    provider,
    county,
    sourceDefinitions,
    internal = getLocationResearch(provider.id),
  ) {
    const data = publicLocationResearch(internal);
    const catalog = getReviewCatalog(provider.id);
    const accounts = individualReviews(data, catalog).accounts;
    const counts = reviewAccountCounts(accounts);
    assert.equal(data.providerId, provider.id);
    assert.equal(data.experience.value, internal.experience.value);
    assert.equal(data.experience.reviewCount, internal.experience.reviewCount);
    assert.equal(
      data.experience.independentSourceCount,
      internal.experience.includedSources.length,
    );
    assert.equal(
      data.experience.reviewCount,
      sum(internal.experience.includedSources.map((s) => s.count)),
    );
    assert.ok(!Object.hasOwn(data, "reviewSamples"));
    assert.ok(!Object.hasOwn(data.experience, "includedSources"));

    const sources = new Map();
    const registry = new Set();
    const evidence = Object.fromEntries(dimensions.map((key) => [key, {}]));
    const historicalInsuranceDirectoryPageReferences = {};
    function source(item, registryOnly = false) {
      assert.ok(
        item.id && item.publisher,
        `${provider.id} has an unidentified source`,
      );
      sources.set(item.id, item);
      const previous = sourceDefinitions[item.id];
      if (previous) assert.equal(previous.kind, item.kind);
      sourceDefinitions[item.id] = {
        publishers: sorted([...(previous?.publishers ?? []), item.publisher]),
        kind: item.kind,
      };
      if (registryOnly) registry.add(item.id);
    }
    function add(kind, sourceId, count) {
      assert.ok(
        sources.has(sourceId),
        `${provider.id} has an unlinked ${kind} fact`,
      );
      if (count)
        evidence[kind][sourceId] = (evidence[kind][sourceId] ?? 0) + count;
    }
    for (const item of data.sources) source(item, item.kind === "regulator");
    for (const item of catalog?.sources ?? []) {
      source({
        ...item,
        kind: sources.get(item.id)?.kind ?? "review-platform",
      });
    }
    if (data.registrationFacts) {
      source(
        {
          id: "nj-hp-registry",
          publisher: data.registrationFacts.source.publisher,
          kind: "regulator",
        },
        true,
      );
    }
    const identifiers = data.officeIdentifiers;
    if (identifiers?.federalOrganization) {
      source(
        {
          id: syntheticId("nppes", identifiers.federalOrganization.sourceUrl),
          publisher: "CMS NPPES",
          kind: "regulator",
        },
        true,
      );
    }
    for (const directory of identifiers?.historicalDirectories ?? []) {
      for (const item of directory.sources) {
        const id = syntheticId("historical-directory", item.url);
        source({
          id,
          publisher: directory.payer,
          kind: "public-directory",
        });
        if (!evidence.historicalInsuranceDirectories[id])
          add("historicalInsuranceDirectories", id, 1);
        historicalInsuranceDirectoryPageReferences[id] =
          (historicalInsuranceDirectoryPageReferences[id] ?? 0) + 1;
      }
    }
    for (const directory of data.officeDirectories ?? []) {
      assert.equal(directory.providerId, provider.id);
      source(directory.source);
      add("services", directory.source.id, directory.services.length);
      add(
        "accreditations",
        directory.source.id,
        directory.accreditations?.length ?? 0,
      );
      add("payments", directory.source.id, directory.paymentOptions.length);
      add(
        "insurance",
        directory.source.id,
        directory.paymentOptions.filter((option) =>
          /\binsurance\b/i.test(option),
        ).length,
      );
    }
    for (const fact of data.facts) {
      assert.ok(
        sources.has(fact.sourceId),
        `${provider.id} has an unlinked fact`,
      );
      if (registry.has(fact.sourceId)) continue;
      const service =
        fact.kind === "care" &&
        (/-services(?:-\d+)?$/.test(fact.id) ||
          (/-offering-\d+$/.test(fact.id) &&
            /^The provider lists /i.test(fact.text)));
      add(
        service ? "services" : fact.kind === "cost" ? "payments" : "otherFacts",
        fact.sourceId,
        1,
      );
    }
    const aggregates = internal.experience.includedSources
      .map((item) => {
        assert.ok(sources.has(item.sourceId));
        assert.ok(
          data.reviewAggregates.some(
            (aggregate) =>
              aggregate.sourceId === item.sourceId &&
              aggregate.count === item.count,
          ),
        );
        return {
          sourceId: item.sourceId,
          platform: item.platform,
          sourceFamily: item.sourceFamily,
          count: item.count,
        };
      })
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    const individual = [];
    for (const sourceId of sorted(
      accounts.map((account) => account.sourceId),
    )) {
      assert.ok(
        sources.has(sourceId),
        `${provider.id} has an unlinked account`,
      );
      const selected = accounts.filter(
        (account) => account.sourceId === sourceId,
      );
      individual.push({
        sourceId,
        ...accountRecord(selected, new Set(sources.keys())),
      });
    }
    assert.equal(sum(individual.map((item) => item.total)), counts.total);
    assert.equal(sum(individual.map((item) => item.withText)), counts.withText);
    const record = {
      county,
      score: data.experience.value,
      aggregateReviewCount: data.experience.reviewCount,
      aggregates,
      individual,
      eligibleReadableReviews: sum(individual.map((s) => s.eligibleReadable)),
      eligibleReadableRelationships: relationshipCounts(individual),
      registration: Boolean(data.registrationFacts),
      historicalInsuranceDirectories:
        Object.keys(evidence.historicalInsuranceDirectories).length > 0,
      historicalInsuranceDirectoryPageReferences,
      retainedLocationRecord: markets.some((market) =>
        Object.hasOwn(market.locationResearch ?? {}, provider.id),
      ),
      registrySourceIds: sorted(registry),
      sourceIds: sorted(sources.keys()),
      sourcePublishers: Object.fromEntries(
        [...sources].map(([id, item]) => [id, item.publisher]),
      ),
      externalProfileCount: getExternalReviewProfiles(provider.id).length,
      evidence,
    };
    if (record.score !== null)
      assert.ok(Number.isFinite(record.score) && aggregates.length > 0);
    record.coverage = classification(record);
    return record;
  }

  function summarize(records) {
    const denominator = records.length;
    const coverage = {
      scored: (r) => r.score !== null,
      eligibleAggregates: (r) => r.aggregates.length > 0,
      individualReviews: (r) => r.individual.some((s) => s.total > 0),
      readableIndividualReviews: (r) =>
        r.individual.some((s) => s.withText > 0),
      eligibleReadableReviews: (r) =>
        r.individual.some((s) => s.eligibleReadable > 0),
      unscoredWithEligibleReadableReviews: (r) =>
        r.score === null && r.individual.some((s) => s.eligibleReadable > 0),
      unratedIndividualReviews: (r) => r.individual.some((s) => s.unrated > 0),
      unratedReadableIndividualReviews: (r) =>
        r.individual.some((s) => s.unratedWithText > 0),
      unscoredWithIndividualReviews: (r) =>
        r.score === null && r.individual.some((s) => s.total > 0),
      registration: (r) => r.registration,
      retainedLocationRecord: (r) => r.retainedLocationRecord,
      externalProfiles: (r) => r.externalProfileCount > 0,
      registryOnly: (r) => r.coverage === "registry-only",
      noResearch: (r) => r.coverage === "no-research",
      research: (r) => r.coverage === "research",
      ...Object.fromEntries(
        dimensions.map((key) => [
          key,
          (r) => Object.keys(r.evidence[key]).length > 0,
        ]),
      ),
    };
    const groupedAggregates = (key) =>
      Object.fromEntries(
        sorted(records.flatMap((r) => r.aggregates.map((s) => s[key]))).map(
          (value) => [
            value,
            aggregateSummary(records, (_, s) => s[key] === value),
          ],
        ),
      );
    const aggregateCounts = aggregateSummary(records);
    const counts = {
      ...Object.fromEntries(
        aggregateMetrics.map((key) => [key, aggregateCounts[key]]),
      ),
      eligibleReadableReviews: sum(
        records.flatMap((r) => r.individual.map((s) => s.eligibleReadable)),
      ),
      unscoredWithEligibleReadableReviews: sum(
        records
          .filter((r) => r.score === null)
          .flatMap((r) => r.individual.map((s) => s.eligibleReadable)),
      ),
      individualReviews: sum(
        records.flatMap((r) => r.individual.map((s) => s.total)),
      ),
      readableIndividualReviews: sum(
        records.flatMap((r) => r.individual.map((s) => s.withText)),
      ),
      unratedIndividualReviews: sum(
        records.flatMap((r) => r.individual.map((s) => s.unrated)),
      ),
      unratedReadableIndividualReviews: sum(
        records.flatMap((r) => r.individual.map((s) => s.unratedWithText)),
      ),
      originalSummaries: sum(
        records.flatMap((r) => r.individual.map((s) => s.originalSummaries)),
      ),
      externalProfiles: sum(records.map((r) => r.externalProfileCount)),
      pageReferenceCount: sum(
        records.flatMap((r) =>
          Object.values(r.historicalInsuranceDirectoryPageReferences),
        ),
      ),
      ...Object.fromEntries(
        dimensions.map((key) => [
          key,
          sum(records.flatMap((r) => Object.values(r.evidence[key]))),
        ]),
      ),
    };
    return {
      providerCount: denominator,
      coverage: Object.fromEntries(
        entries(coverage).map(([key, predicate]) => [
          key,
          fraction(records.filter(predicate).length, denominator),
        ]),
      ),
      counts,
      eligibleReadableRelationships: relationshipCounts(
        records.flatMap((r) => r.individual),
      ),
      platforms: groupedAggregates("platform"),
      families: groupedAggregates("sourceFamily"),
    };
  }

  function sourceSummary(records, ids, publisher) {
    const matches = (record, id) =>
      ids.has(id) && (!publisher || record.sourcePublishers[id] === publisher);
    const selected = records.filter((record) =>
      record.sourceIds.some((id) => matches(record, id)),
    );
    const accounts = selected.flatMap((r) =>
      r.individual.filter((s) => matches(r, s.sourceId)),
    );
    return {
      providers: fraction(selected.length, records.length),
      pageReferenceCount: sum(
        selected.flatMap((r) =>
          entries(r.historicalInsuranceDirectoryPageReferences)
            .filter(([id]) => matches(r, id))
            .map(([, count]) => count),
        ),
      ),
      ...aggregateSummary(records, (r, s) => matches(r, s.sourceId)),
      eligibleReadableReviews: sum(accounts.map((s) => s.eligibleReadable)),
      eligibleReadableRelationships: relationshipCounts(accounts),
      unscoredWithEligibleReadableReviews: sum(
        selected
          .filter((r) => r.score === null)
          .flatMap((r) =>
            r.individual
              .filter((s) => matches(r, s.sourceId))
              .map((s) => s.eligibleReadable),
          ),
      ),
      eligibleReadableProviders: fraction(
        selected.filter((r) =>
          r.individual.some(
            (s) => matches(r, s.sourceId) && s.eligibleReadable > 0,
          ),
        ).length,
        records.length,
      ),
      unscoredWithEligibleReadableProviders: fraction(
        selected.filter(
          (r) =>
            r.score === null &&
            r.individual.some(
              (s) => matches(r, s.sourceId) && s.eligibleReadable > 0,
            ),
        ).length,
        records.length,
      ),
      individualReviews: sum(accounts.map((s) => s.total)),
      readableIndividualReviews: sum(accounts.map((s) => s.withText)),
      unratedIndividualReviews: sum(accounts.map((s) => s.unrated)),
      unratedReadableIndividualReviews: sum(
        accounts.map((s) => s.unratedWithText),
      ),
      ...Object.fromEntries(
        dimensions.map((key) => [
          key,
          {
            providers: fraction(
              selected.filter((r) =>
                Object.keys(r.evidence[key]).some((id) => matches(r, id)),
              ).length,
              records.length,
            ),
            count: sum(
              selected.flatMap((r) =>
                entries(r.evidence[key])
                  .filter(([id]) => matches(r, id))
                  .map(([, count]) => count),
              ),
            ),
          },
        ]),
      ),
    };
  }

  function buildReport(date) {
    const crosswalk = JSON.parse(
      readFileSync(
        join(root, "research/north-jersey/runtime/crosswalk.json"),
        "utf8",
      ),
    ).filter(
      (row) => row.source === "NJ HP registry" && row.status === "included",
    );
    const counties = new Map();
    for (const row of crosswalk) {
      assert.ok(
        typeof row.county === "string" && row.county.trim(),
        "Included registry row needs a county",
      );
      assert.ok(
        !counties.has(row.providerId),
        "Duplicate included registry provider",
      );
      counties.set(row.providerId, row.county);
    }
    const roster = markets
      .flatMap((market) => market.providers)
      .filter(
        (provider) =>
          provider.state === "NJ" &&
          provider.category === "home-care" &&
          /^north-jersey-hp-hp\d+$/.test(provider.id),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    assert.ok(roster.length, "Published HCSF roster must not be empty");
    assert.deepEqual(
      roster.map((p) => p.id),
      sorted(counties.keys()),
      "Published roster and included registry crosswalk must reconcile",
    );
    const definitions = {};
    const providers = Object.fromEntries(
      roster.map((provider) => [
        provider.id,
        providerRecord(provider, counties.get(provider.id), definitions),
      ]),
    );
    const records = Object.values(providers);
    const countyNames = sorted(counties.values());
    const byCounty = Object.fromEntries(
      countyNames.map((county) => [
        county,
        summarize(records.filter((record) => record.county === county)),
      ]),
    );
    const bySource = Object.fromEntries(
      entries(definitions).map(([id, definition]) => [
        id,
        { ...definition, ...sourceSummary(records, new Set([id])) },
      ]),
    );
    const byPublisher = Object.fromEntries(
      sorted(Object.values(definitions).flatMap((s) => s.publishers)).map(
        (publisher) => {
          const ids = new Set(
            entries(definitions)
              .filter(([, s]) => s.publishers.includes(publisher))
              .map(([id]) => id),
          );
          return [
            publisher,
            {
              ...sourceSummary(records, ids, publisher),
              byCounty: Object.fromEntries(
                countyNames.map((county) => [
                  county,
                  sourceSummary(
                    records.filter((r) => r.county === county),
                    ids,
                    publisher,
                  ),
                ]),
              ),
            },
          ];
        },
      ),
    );
    const report = {
      schemaVersion: 1,
      asOfDate: date,
      totals: summarize(records),
      byCounty,
      byPublisher,
      bySource,
      providers,
    };
    for (const [key, value] of entries(report.totals.coverage)) {
      assert.equal(
        sum(
          Object.values(byCounty).map(
            (county) => county.coverage[key].numerator,
          ),
        ),
        value.numerator,
        `County ${key} reconciliation`,
      );
      assert.equal(
        sum(
          Object.values(byCounty).map(
            (county) => county.coverage[key].denominator,
          ),
        ),
        value.denominator,
      );
    }
    for (const [key, value] of entries(report.totals.counts)) {
      assert.equal(
        sum(Object.values(byCounty).map((county) => county.counts[key])),
        value,
        `County ${key} count reconciliation`,
      );
    }
    assert.equal(
      sum(Object.values(byCounty).map((county) => county.providerCount)),
      roster.length,
    );
    assert.equal(
      sum(
        ["research", "registryOnly", "noResearch"].map(
          (key) => report.totals.coverage[key].numerator,
        ),
      ),
      roster.length,
    );
    for (const key of [
      ...aggregateMetrics,
      ...accountMetrics,
      "pageReferenceCount",
    ]) {
      assert.equal(
        sum(Object.values(bySource).map((source) => source[key])),
        report.totals.counts[key],
        `Source ${key} reconciliation`,
      );
      assert.equal(
        sum(Object.values(byPublisher).map((publisher) => publisher[key])),
        report.totals.counts[key],
        `Publisher ${key} reconciliation`,
      );
      for (const publisher of Object.values(byPublisher)) {
        assert.equal(
          sum(Object.values(publisher.byCounty).map((county) => county[key])),
          publisher[key],
          `Publisher county ${key} reconciliation`,
        );
      }
    }
    for (const summary of [report.totals, ...Object.values(byCounty)]) {
      for (const [group, field] of [
        [summary.platforms, "platform"],
        [summary.families, "sourceFamily"],
      ]) {
        for (const key of aggregateMetrics) {
          assert.equal(
            sum(Object.values(group).map((item) => item[key])),
            summary.counts[key],
            `Aggregate family/platform ${key} reconciliation`,
          );
        }
        const local = records.filter(
          (r) => summary === report.totals || byCounty[r.county] === summary,
        );
        for (const [name, item] of entries(group)) {
          for (const key of ["scoredProviders", "eligibleAggregateProviders"]) {
            assert.equal(
              item[key].numerator,
              local.filter(
                (r) =>
                  (key !== "scoredProviders" || r.score !== null) &&
                  r.aggregates.some((s) => s[field] === name),
              ).length,
            );
            assert.equal(item[key].denominator, summary.providerCount);
          }
        }
      }
    }
    for (const key of relationships) {
      const expected = report.totals.eligibleReadableRelationships[key];
      for (const group of [byCounty, bySource, byPublisher]) {
        assert.equal(
          sum(
            Object.values(group).map(
              (item) => item.eligibleReadableRelationships[key],
            ),
          ),
          expected,
          `Eligible ${key} relationship reconciliation`,
        );
      }
      for (const publisher of Object.values(byPublisher)) {
        assert.equal(
          sum(
            Object.values(publisher.byCounty).map(
              (county) => county.eligibleReadableRelationships[key],
            ),
          ),
          publisher.eligibleReadableRelationships[key],
        );
      }
    }
    for (const record of records) {
      assert.equal(
        sum(Object.values(record.eligibleReadableRelationships)),
        record.eligibleReadableReviews,
      );
      assert.equal(
        sum(record.aggregates.map((s) => s.count)),
        record.aggregateReviewCount,
      );
      for (const aggregate of record.aggregates)
        assert.ok(
          aggregate.sourceFamily?.trim(),
          "Canonical aggregate family is required",
        );
      for (const item of record.individual) {
        assert.ok(
          item.eligibleReadable <= item.withText && item.withText <= item.total,
        );
        assert.equal(
          sum(Object.values(item.eligibleReadableRelationships)),
          item.eligibleReadable,
        );
        assert.equal(item.eligibleReadableRelationships.staff, 0);
      }
    }
    for (const publisher of Object.values(byPublisher)) {
      for (const key of [
        "providers",
        "scoredProviders",
        "eligibleAggregateProviders",
        "eligibleReadableProviders",
        "unscoredWithEligibleReadableProviders",
      ]) {
        assert.equal(
          sum(
            Object.values(publisher.byCounty).map(
              (county) => county[key].numerator,
            ),
          ),
          publisher[key].numerator,
        );
        assert.equal(
          sum(
            Object.values(publisher.byCounty).map(
              (county) => county[key].denominator,
            ),
          ),
          publisher[key].denominator,
        );
      }
    }
    for (const key of dimensions) {
      assert.equal(
        sum(Object.values(bySource).map((source) => source[key].count)),
        report.totals.counts[key],
      );
      assert.equal(
        sum(
          Object.values(byPublisher).map((publisher) => publisher[key].count),
        ),
        report.totals.counts[key],
      );
    }
    return report;
  }

  function selfTest() {
    const provider = markets
      .flatMap((market) => market.providers)
      .find(
        (p) =>
          getHomeCareOfficeIdentifiers(p.id)?.historicalDirectories?.length,
      );
    assert.ok(provider, "Runtime getter must supply historicalDirectories");
    const internal = getLocationResearch(provider.id);
    const identifiers = getHomeCareOfficeIdentifiers(provider.id);
    assert.deepEqual(
      publicLocationResearch(internal).officeIdentifiers,
      identifiers,
      "Public projection must retain the getter's historicalDirectories",
    );
    const runtimeRecord = providerRecord(provider, "Test", {});
    assert.deepEqual(
      runtimeRecord.evidence.historicalInsuranceDirectories,
      Object.fromEntries(
        identifiers.historicalDirectories.flatMap((directory) =>
          directory.sources.map((item) => [
            syntheticId("historical-directory", item.url),
            1,
          ]),
        ),
      ),
      "Audit must consume the runtime getter's plural directory field",
    );
    const fixture = providerRecord(
      provider,
      "Test",
      {},
      {
        ...internal,
        sources: [],
        facts: [],
        reviews: [],
        reviewAggregates: [],
        experience: computeExperienceScore({
          asOfDate: "2026-11-14",
          sources: [],
          reviewAggregates: [],
        }),
        officeDirectories: [],
        officeIdentifiers: {
          providerId: provider.id,
          historicalDirectories: [
            {
              payer: "Fixture payer",
              program: "Fixture program",
              checkedAt: "2026-11-14",
              sources: [1, 2].map((physicalPage) => ({
                url: "https://example.test/historical-directory.pdf",
                asOf: "2020-01-01",
                physicalPage,
              })),
            },
          ],
        },
      },
    );
    const fixtureId = syntheticId(
      "historical-directory",
      "https://example.test/historical-directory.pdf",
    );
    assert.deepEqual(fixture.evidence.historicalInsuranceDirectories, {
      [fixtureId]: 1,
    });
    assert.deepEqual(fixture.historicalInsuranceDirectoryPageReferences, {
      [fixtureId]: 2,
    });
    assert.equal(fixture.historicalInsuranceDirectories, true);
    assert.equal(fixture.sourcePublishers[fixtureId], "Fixture payer");
    assert.equal(fixture.registrySourceIds.includes(fixtureId), false);
    assert.equal(fixture.coverage, "research");
    assert.deepEqual(fixture.evidence.insurance, {});
    assert.deepEqual(fixture.evidence.payments, {});
    const fixtureSummary = summarize([fixture]);
    assert.deepEqual(
      fixtureSummary.coverage.historicalInsuranceDirectories,
      fraction(1, 1),
    );
    assert.equal(fixtureSummary.counts.historicalInsuranceDirectories, 1);
    assert.equal(fixtureSummary.counts.pageReferenceCount, 2);
    for (const publisher of [undefined, "Fixture payer"]) {
      const totals = sourceSummary([fixture], new Set([fixtureId]), publisher);
      assert.deepEqual(totals.historicalInsuranceDirectories, {
        providers: fraction(1, 1),
        count: 1,
      });
      assert.equal(totals.pageReferenceCount, 2);
      assert.equal(totals.insurance.count, 0);
      assert.equal(totals.payments.count, 0);
    }
    const input = {
      asOfDate: "2026-11-14",
      sources: [
        {
          id: "google",
          url: "https://www.google.com/maps/place/test",
          kind: "review-platform",
          access: "full-page",
          checkedAt: "2026-11-14",
        },
      ],
      reviewAggregates: [
        {
          sourceId: "google",
          platform: "Google",
          sourceFamily: "google",
          rating: 4.5,
          scale: 5,
          count: 6,
          asOf: "2026-11-14",
          scope: "consumer",
        },
      ],
    };
    const sparse = computeExperienceScore(input);
    assert.equal(sparse.value, null);
    assert.equal(sparse.includedSources.length, 1);
    assert.equal(sparse.includedSources[0].sourceFamily, "google");
    assert.equal(sparse.reviewCount, 6);
    const scored = computeExperienceScore({
      ...input,
      reviewAggregates: [{ ...input.reviewAggregates[0], count: 30 }],
    });
    assert.equal(scored.value, 9);
    assert.equal(scored.reviewCount, 30);
    const excluded = computeExperienceScore({
      ...input,
      sources: [{ ...input.sources[0], access: "search-result" }],
    });
    assert.equal(excluded.includedSources.length, 0);
    assert.equal(excluded.reviewCount, 0);
    const catalog = {
      providerId: "test",
      sources: [{ id: "google", publisher: "Google" }],
      accounts: [
        {
          id: "one",
          sourceId: "google",
          url: "https://example.test/one",
          date: null,
          relationship: "family",
          excerpt: null,
          summary: "Synthetic account.",
          representation: "original-summary",
        },
      ],
      notes: [],
    };
    const merged = individualReviews(
      { providerId: "test", sources: [], reviews: [] },
      catalog,
    );
    assert.deepEqual(reviewAccountCounts(merged.accounts), {
      total: 1,
      withText: 1,
    });
    assert.deepEqual(
      reviewAccountCounts(
        individualReviews(
          { providerId: "test", sources: [], reviews: merged.accounts },
          catalog,
        ).accounts,
      ),
      { total: 1, withText: 1 },
    );
    const valid = {
      ...merged.accounts[0],
      rating: 4,
      scale: 5,
    };
    const sourceIds = new Set(["google"]);
    assert.equal(eligibleReadable(valid, sourceIds), true);
    for (const overrides of [
      { relationship: "staff" },
      { providerSelected: true },
      { searchResultOnly: true },
      { representation: "link-only" },
      { excerpt: " \n ", summary: "\t" },
      { sourceId: "missing" },
    ]) {
      const account = { ...valid, ...overrides };
      assert.equal(eligibleReadable(account, sourceIds), false);
      assert.equal(accountRecord([account], sourceIds).total, 1);
      assert.equal(accountRecord([account], sourceIds).eligibleReadable, 0);
    }
    assert.equal(
      eligibleReadable(
        { ...valid, excerpt: " A retained excerpt. ", summary: "" },
        sourceIds,
      ),
      true,
    );
    assert.equal(
      eligibleReadable({ ...valid, summary: "A summary." }, new Set()),
      false,
    );
    const mixedRelationships = accountRecord(
      [
        valid,
        { ...valid, relationship: "resident" },
        { ...valid, relationship: "unknown" },
      ],
      sourceIds,
    );
    assert.deepEqual(mixedRelationships.eligibleReadableRelationships, {
      family: 1,
      resident: 1,
      staff: 0,
      visitor: 0,
      unknown: 1,
    });
    const individual = [
      {
        sourceId: "google",
        ...accountRecord(
          [
            valid,
            {
              ...valid,
              summary: "",
              rating: null,
              representation: "link-only",
            },
          ],
          sourceIds,
        ),
      },
    ];
    const record = {
      county: "Test",
      score: null,
      aggregateReviewCount: 6,
      aggregates: [
        {
          sourceId: "google",
          platform: "Mirror",
          sourceFamily: "google",
          count: 6,
        },
      ],
      individual,
      registration: true,
      retainedLocationRecord: true,
      registrySourceIds: ["registry"],
      sourceIds: ["registry", "google"],
      sourcePublishers: { registry: "Registry", google: "Mirror" },
      historicalInsuranceDirectoryPageReferences: {},
      externalProfileCount: 0,
      evidence: Object.fromEntries(dimensions.map((key) => [key, {}])),
    };
    record.coverage = classification(record);
    const summary = summarize([record]);
    assert.equal(summary.coverage.scored.numerator, 0);
    assert.equal(summary.coverage.eligibleAggregates.numerator, 1);
    assert.equal(summary.counts.aggregateReportedReviews, 6);
    assert.equal(summary.counts.unratedReadableIndividualReviews, 0);
    assert.equal(summary.counts.eligibleReadableReviews, 1);
    assert.equal(summary.counts.unscoredWithEligibleReadableReviews, 1);
    assert.equal(
      summary.coverage.unscoredWithEligibleReadableReviews.numerator,
      1,
    );
    assert.equal(summary.platforms.Mirror.aggregateReportedReviews, 6);
    assert.equal(summary.families.google.aggregateReportedReviews, 6);
    const scoredRecord = {
      ...record,
      score: 9,
      aggregateReviewCount: 30,
      aggregates: [{ ...record.aggregates[0], count: 30 }],
      individual: [
        {
          sourceId: "google",
          ...accountRecord([{ ...valid, rating: null }], sourceIds),
        },
      ],
    };
    const combined = summarize([record, scoredRecord]);
    assert.equal(combined.counts.eligibleReadableReviews, 2);
    assert.equal(combined.counts.unscoredWithEligibleReadableReviews, 1);
    assert.equal(combined.counts.unratedReadableIndividualReviews, 1);
    assert.deepEqual(combined.platforms.Mirror, {
      scoredProviders: fraction(1, 2),
      eligibleAggregateProviders: fraction(2, 2),
      scoredAggregates: 1,
      scoredAggregateReportedReviews: 30,
      eligibleAggregates: 2,
      aggregateReportedReviews: 36,
    });
    assert.deepEqual(combined.families.google, combined.platforms.Mirror);
    const sourceTotals = sourceSummary([record, scoredRecord], sourceIds);
    const publisherTotals = sourceSummary(
      [record, scoredRecord],
      sourceIds,
      "Mirror",
    );
    assert.deepEqual(sourceTotals, publisherTotals);
    for (const key of [...aggregateMetrics, ...accountMetrics])
      assert.equal(sourceTotals[key], combined.counts[key], `Synthetic ${key}`);
    assert.deepEqual(
      sourceTotals.unscoredWithEligibleReadableProviders,
      fraction(1, 2),
    );
    assert.deepEqual(sourceTotals.eligibleReadableProviders, fraction(2, 2));
    assert.deepEqual(
      sourceTotals.eligibleReadableRelationships,
      combined.eligibleReadableRelationships,
    );
    assert.equal(
      summarize([
        {
          ...record,
          individual: [
            {
              sourceId: "google",
              ...accountRecord(
                [{ ...valid, relationship: "staff" }],
                sourceIds,
              ),
            },
          ],
        },
      ]).coverage.unscoredWithEligibleReadableReviews.numerator,
      0,
    );
    assert.equal(
      sourceSummary([record], new Set(["google"])).individualReviews,
      2,
    );
    assert.equal(
      classification({ ...record, sourceIds: ["registry"] }),
      "registry-only",
    );
    assert.equal(
      classification({ ...record, sourceIds: [], registrySourceIds: [] }),
      "no-research",
    );
    assert.equal(
      classification({
        ...record,
        sourceIds: ["registry"],
        externalProfileCount: 1,
      }),
      "research",
    );
    assert.equal(
      summarize([{ ...record, score: 9 }]).coverage.scored.numerator,
      1,
    );
    assert.equal(summarize([]).providerCount, 0);
  }

  async function verifyOrigin(origin, report) {
    const url = new URL(origin);
    assert.ok(
      url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash,
      "--origin must be a credential-free HTTPS origin",
    );
    const scored = entries(report.providers)
      .filter(([, r]) => r.score !== null)
      .slice(0, 2);
    assert.equal(
      scored.length,
      2,
      "Origin verification requires at least two locally scored providers",
    );
    for (const [id, record] of scored) {
      const endpoint = new URL("/api/research", url);
      endpoint.searchParams.set("id", id);
      const response = await fetch(endpoint, {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      assert.equal(
        response.status,
        200,
        `Production research request failed for ${id}`,
      );
      const data = await response.json();
      assert.equal(data.providerId, id);
      assert.equal(
        data.experience.value,
        record.score,
        `Production score differs for ${id}`,
      );
      assert.equal(data.experience.reviewCount, record.aggregateReviewCount);
      assert.equal(
        data.experience.independentSourceCount,
        record.aggregates.length,
      );
      for (const source of record.aggregates) {
        assert.ok(
          data.reviewAggregates.some(
            (aggregate) =>
              aggregate.sourceId === source.sourceId &&
              aggregate.count === source.count,
          ),
        );
      }
      console.log(`API projection verified for ${id}`);
    }
  }

  async function main() {
    const args = process.argv.slice(2);
    let origin;
    let testOnly = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--self-test") testOnly = true;
      else if (args[i] === "--origin" && args[i + 1]) origin = args[++i];
      else
        throw new Error(
          "Usage: node audit.cjs [--self-test] [--origin https://host]",
        );
    }
    selfTest();
    const date = new Date().toISOString().slice(0, 10);
    const report = buildReport(date);
    assert.deepEqual(
      buildReport(date),
      report,
      "Repeated runtime projections must be stable",
    );
    if (origin) await verifyOrigin(origin, report);
    if (!testOnly) {
      const { providers, bySource, byPublisher, ...summary } = report;
      const compact = { byPublisher, bySource, providers };
      const body = `${JSON.stringify(summary, null, 2).slice(0, -2)},\n${entries(
        compact,
      )
        .map(
          ([key, rows]) =>
            `  ${JSON.stringify(key)}: {\n${entries(rows)
              .map(
                ([id, record]) =>
                  `    ${JSON.stringify(id)}: ${JSON.stringify(record)}`,
              )
              .join(",\n")}\n  }`,
        )
        .join(",\n")}\n}\n`;
      assert.deepEqual(JSON.parse(body), report);
      writeFileSync(join(__dirname, "report.json"), body);
    }
    console.log(
      JSON.stringify(
        {
          selfTests: "passed",
          stableRerun: "passed",
          wroteReport: !testOnly,
          ...report.totals,
        },
        null,
        2,
      ),
    );
  }

  await main();
}

audit().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
