/** Wikidata's public SPARQL endpoint (CORS-enabled): one helper with a timeout and typed rows. */
export type SparqlRow = Record<string, { value: string } | undefined>;

export function sparql(q: string, timeoutMs = 45_000): Promise<SparqlRow[]> {
  return fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    headers: { Accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(timeoutMs),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Wikidata ${r.status}`))))
    .then((j) => j.results.bindings as SparqlRow[]);
}
