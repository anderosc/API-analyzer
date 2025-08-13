import  { useState, useRef } from "react";
import "./App.css";

type FetchSummary = {
  url: string;
  method: string;
  status: number;
  statusText: string;
  timeMs: number;
  contentType?: string | null;
  sizeBytes?: number | null;
  date?: string | null;
};

type AnalyzedResult =
  | {
      ok: true;
      summary: FetchSummary;
      headers: Record<string, string>;
      data: unknown;
      rawText: string;
    }
  | {
      ok: false;
      summary?: FetchSummary;
      headers?: Record<string, string>;
      error: string;
      rawText?: string;
    };

// Helpers
const formatMs = (ms: number) => `${ms.toFixed(0)} ms`;
const formatBytes = (bytes?: number | null) =>
  bytes == null
    ? "—"
    : bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// JSON Tree
type TreeProps = {
  name?: string;
  data: unknown;
  level?: number;
  collapsed?: boolean;
};

function TreeNode({ name, data, level = 0, collapsed }: TreeProps) {
  const [open, setOpen] = useState<boolean>(collapsed ? false : level < 1);

  const toggle = () => setOpen(!open);
  const isArr = Array.isArray(data);
  const isObj = isObject(data);

  const label = name ?? (isArr ? "[]" : isObj ? "{}" : "");

  if (!isArr && !isObj) {
    return (
      <div className="tree-row leaf" style={{ marginLeft: level * 14 }}>
        {name !== undefined && <span className="key">{label}: </span>}
        <Value data={data} />
      </div>
    );
  }

  const entries: [string, unknown][] = isArr
    ? (data as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(data as Record<string, unknown>);

  return (
    <div className="tree-node">
      <div className="tree-row" style={{ marginLeft: level * 14 }}>
        <button className="twisty" onClick={toggle} aria-label={open ? "Collapse" : "Expand"}>
          {open ? "▾" : "▸"}
        </button>
        <span className="key">{label}</span>
        <span className="meta">{isArr ? `  [${(data as unknown[]).length}]` : `  {${entries.length}}`}</span>
      </div>
      {open && (
        <div className="children">
          {entries.map(([k, v]) => (
            <TreeNode key={k} name={k} data={v} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function Value({ data }: { data: unknown }) {
  switch (typeof data) {
    case "string":
      return <span className="val string">"{data}"</span>;
    case "number":
      return <span className="val number">{data}</span>;
    case "boolean":
      return <span className="val bool">{String(data)}</span>;
    case "object":
      return <span className="val null">{data === null ? "null" : "object"}</span>;
    default:
      return <span className="val">{String(data)}</span>;
  }
}

// Main App
function App() {
  const [url, setUrl] = useState<string>("Paste your API here");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzedResult | null>(null);
  const [timeoutMs, setTimeoutMs] = useState(15000);
  const [method, setMethod] = useState<"GET" | "HEAD">("GET");
  const controllerRef = useRef<AbortController | null>(null);

  async function analyze() {
    setLoading(true);
    setResult(null);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const started = performance.now();
      const t = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, {
        method,
        signal: controller.signal,
        headers: { Accept: "application/json,*/*" },
        cache: "no-store",
      });

      const elapsed = performance.now() - started;
      const headers: Record<string, string> = {};
      resp.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));

      const rawText = method === "HEAD" ? "" : await resp.text();
      const fromHeader = Number(headers["content-length"]);
      const sizeBytes =
        !Number.isNaN(fromHeader) && fromHeader > 0
          ? fromHeader
          : rawText
          ? new TextEncoder().encode(rawText).length
          : null;

      let parsed: unknown = null;
      let parseErr: string | null = null;

      if (rawText && headers["content-type"]?.toLowerCase().includes("json")) {
        try {
          parsed = JSON.parse(rawText);
        } catch (e) {
          parseErr = (e as Error).message;
        }
      } else if (rawText) {
        try {
          parsed = JSON.parse(rawText);
        } catch {
          parsed = rawText;
        }
      }

      const summary: FetchSummary = {
        url,
        method,
        status: resp.status,
        statusText: resp.statusText || (resp.ok ? "OK" : "Error"),
        timeMs: elapsed,
        contentType: headers["content-type"] ?? null,
        sizeBytes: sizeBytes ?? null,
        date: headers["date"] ?? null,
      };

      clearTimeout(t);

      if (!resp.ok) {
        setResult({ ok: false, summary, headers, error: `Request failed with status ${resp.status}`, rawText });
        return;
      }

      if (parseErr) {
        setResult({ ok: false, summary, headers, error: `Response is not valid JSON: ${parseErr}`, rawText });
        return;
      }

      setResult({ ok: true, summary, headers, data: parsed, rawText });
    } catch (e) {
      const msg = (e as any)?.name === "AbortError" ? `Request aborted after ${timeoutMs} ms` : (e as Error).message;
      setResult({ ok: false, error: msg });
    } finally {
      setLoading(false);
    }
  }

  const headerRows = result?.headers ? Object.entries(result.headers).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <div className="wrap">
      <h1 className="title">JSON API Analyzer</h1>
      <p className="subtitle">
        Enter API URL, click <strong>Analyze</strong> and check summary of API and JSON tree.
      </p>

      <div className="panel">
        <div className="controls">
          <input
            className="input"
            placeholder="https://api.yourservice.com/data"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <select className="select" value={method} onChange={(e) => setMethod(e.target.value as "GET" | "HEAD")}>
            <option>GET</option>
          </select>
          <input
            className="input mono"
            type="number"
            min={1000}
            step={500}
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number(e.target.value))}
            title="Timeout (ms)"
          />
          <button className="btn" disabled={loading || !url.trim()} onClick={analyze}>
            {loading ? "Fetching…" : "Analyze"}
          </button>
        </div>

        <div className="section">
          {!result && (
            <p className="hint">
              Example: You can try <span className="badge">https://fakestoreapi.com/products</span>
            </p>
          )}

          {result && (
            <div className="grid">
              <div className="panel section">
                <h3>Summary</h3>
                <table>
                  <tbody>
                    <tr>
                      <th>URL</th>
                      <td className="mono">{result.ok ? result.summary.url : result.summary?.url ?? url}</td>
                    </tr>
                    <tr>
                      <th>Method</th>
                      <td>{result.ok ? result.summary.method : result.summary?.method ?? "GET"}</td>
                    </tr>
                    <tr>
                      <th>Status</th>
                      <td>
                        {result.summary ? (
                          <span className={result.summary.status >= 200 && result.summary.status < 300 ? "status-ok" : "status-bad"}>
                            {result.summary.status} {result.summary.statusText}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th>Time</th>
                      <td>{result.summary ? formatMs(result.summary.timeMs) : "—"}</td>
                    </tr>
                    <tr>
                      <th>Content-Type</th>
                      <td>{result.summary?.contentType ?? "—"}</td>
                    </tr>
                    <tr>
                      <th>Size</th>
                      <td>{result.summary ? formatBytes(result.summary.sizeBytes) : "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {result.headers && (
                <div className="panel section">
                  <h3>Headers</h3>
                  <table>
                    <tbody>
                      {headerRows.map(([k, v]) => (
                        <tr key={k}>
                          <th>{k}</th>
                          <td>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.ok && (
                <div className="panel section">
                  <h3>JSON Tree</h3>
                  <TreeNode data={result.data} />
                </div>
              )}

              {!result.ok && (
                <div className="panel section">
                  <h3>Error</h3>
                  <pre className="error">{result.error}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
