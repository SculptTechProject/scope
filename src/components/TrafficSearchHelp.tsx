const examples = [
  ['Failed POST requests', 'filter: method=POST status>=400'],
  ['One host', 'filter: host=api.example.test'],
  ['Response or request text', 'filter: body~="rate limit"'],
  ['In-flight requests', 'filter: state=pending'],
  ['Edited requests', 'filter: edited=true'],
] as const;

export function TrafficSearchHelp({
  error,
  onSelect,
}: {
  error: string;
  onSelect: (query: string) => void;
}) {
  return (
    <div className="traffic-search-help">
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>Search syntax</summary>
        <p>
          Search for ordinary text, or start with <code>filter:</code>. All conditions must match.
          Quote values containing spaces. Use <code>text:filter:</code> to find the literal text
          “filter:”. Body filters search plain text only, excluding binary bodies.
        </p>
        <div className="traffic-search-examples">
          {examples.map(([label, query]) => (
            <button type="button" key={query} onClick={() => onSelect(query)} title={query}>
              {label}: <code>{query}</code>
            </button>
          ))}
        </div>
        <p>
          Status supports <code>= != &gt; &gt;= &lt; &lt;=</code>. Method and host support{' '}
          <code>= !=</code>; host matches the entire hostname without its port. State is{' '}
          <code>pending</code>, <code>error</code> or <code>complete</code>. Desktop filters search
          this session before pagination; MCP search remains literal.
        </p>
      </details>
    </div>
  );
}
