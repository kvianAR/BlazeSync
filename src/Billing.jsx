import React, { useEffect, useRef, useState } from "react";
import {
  Wallet,
  RefreshCw,
  ExternalLink,
  Database,
  History,
  CloudUpload,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

function formatBytes(value) {
  if (value < 1000) return value + " B";
  const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1000)));
  return (
    (value / 1000 ** unit).toFixed(2) +
    " " +
    ["B", "KB", "MB", "GB", "TB"][unit]
  );
}
function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
}
export default function Billing({ api, state }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [budget, setBudget] = useState(String(state.billingBudgetUsd || ""));
  const [saved, setSaved] = useState(false);
  const request = useRef(0);
  const scannedRevision = useRef(state.revision);
  async function refresh(force = false) {
    const current = ++request.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.billing(force);
      if (current !== request.current) return;
      setData(result);
      scannedRevision.current = state.revision;
    } catch (failure) {
      if (current === request.current) setError(failure.message);
    } finally {
      if (current === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
    setError("");
    if (state.connected) refresh();
    return () => {
      request.current++;
    };
  }, [state.connectionId, state.connected]);
  useEffect(() => {
    setBudget(String(state.billingBudgetUsd || ""));
  }, [state.billingBudgetUsd, state.connectionId]);
  const estimate = data?.estimate;
  const exceeded =
    state.billingBudgetUsd > 0 && estimate?.monthlyUsd > state.billingBudgetUsd;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">BACKBLAZE B2 · PUBLIC PRICING</div>
          <h1>Storage & billing</h1>
          <p>Your cloud usage and a 30-day storage projection in USD.</p>
        </div>
        <button
          className="primary"
          disabled={busy || !state.connected}
          onClick={() => refresh(true)}
        >
          <RefreshCw size={17} className={busy ? "spin" : ""} />
          Refresh usage
        </button>
      </div>
      {!state.connected && (
        <section className="card">
          <p>
            Connect Backblaze B2 in Connection settings to calculate your
            storage usage.
          </p>
        </section>
      )}
      {error && (
        <div className="alert" role="alert">
          <AlertCircle size={18} />
          {error}
        </div>
      )}
      {busy && (
        <div className="info-strip">
          <RefreshCw size={18} className="spin" />
          Scanning storage
          {state.billingProgress
            ? ` · ${state.billingProgress.completed}/${state.billingProgress.total} buckets checked`
            : "…"}
        </div>
      )}
      {data && (
        <>
          <section className="billing-hero card">
            <div>
              <span className="pill">
                {estimate.accountComplete
                  ? "ACCOUNT STORAGE PROJECTION"
                  : "VISIBLE STORAGE PROJECTION"}
              </span>
              <h2 className="billing-amount">
                {estimate.accountComplete
                  ? money(estimate.monthlyUsd)
                  : `${money(estimate.monthlyUsd)} – ${money(estimate.visibleMaximumUsd)}`}
                <small>/ 30 days</small>
              </h2>
              <p>
                At the current stored amount, using{" "}
                {money(data.pricing.usdPerTbPer30Days)}/TB per 30 days.
              </p>
              <small>
                Checked {new Date(data.checkedAt).toLocaleString()} ·{" "}
                {data.rows.length} bucket{data.rows.length === 1 ? "" : "s"}{" "}
                scanned
              </small>
            </div>
            <div className="billing-icon">
              <Wallet size={40} />
            </div>
          </section>
          {!estimate.accountComplete && (
            <div className="alert">
              <AlertCircle size={18} />
              <span>
                {data.complete
                  ? "This key can see selected buckets. The 10 GB allowance is shared with the rest of your account, so the range covers visible storage only."
                  : "The scan is incomplete. Totals cover successfully read data. Review bucket errors and refresh to improve the estimate."}
              </span>
            </div>
          )}
          {(data.stale || scannedRevision.current !== state.revision) && (
            <div className="info-strip">
              Storage changed since this scan. Refresh usage to recalculate.
            </div>
          )}
          {exceeded && (
            <div className="alert" role="alert">
              <AlertCircle size={18} />
              Storage projection exceeds your {money(
                state.billingBudgetUsd,
              )}{" "}
              local monthly budget.
            </div>
          )}
          <div className="billing-grid">
            <Metric
              icon={Database}
              label="All stored data"
              value={formatBytes(data.totalBytes)}
              note="Across scanned buckets"
            />
            <Metric
              icon={CheckCircle2}
              label="Free storage allowance"
              value="10 GB"
              note={
                estimate.accountComplete
                  ? `${formatBytes(estimate.remainingFreeBytes)} available at this usage`
                  : "Shared once across your account"
              }
            />
            <Metric
              icon={History}
              label="Retained versions"
              value={formatBytes(data.retainedBytes)}
              note="Old and hidden file versions"
            />
            <Metric
              icon={CloudUpload}
              label="Unfinished uploads"
              value={formatBytes(data.unfinishedBytes)}
              note="Stored multipart upload parts"
            />
          </div>
          <section className="card billing-table">
            <div className="card-heading">
              <Database size={21} />
              <div>
                <h2>Where storage is used</h2>
                <p>
                  Current files, retained versions and unfinished upload parts
                  all contribute.
                </p>
              </div>
            </div>
            <div className="billing-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Bucket</th>
                    <th>Current</th>
                    <th>Retained</th>
                    <th>Unfinished</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <React.Fragment key={row.bucket}>
                      <tr>
                        <th>{row.bucket}</th>
                        <td>{formatBytes(row.currentBytes)}</td>
                        <td>{formatBytes(row.retainedBytes)}</td>
                        <td>{formatBytes(row.unfinishedBytes)}</td>
                        <td>{formatBytes(row.totalBytes)}</td>
                      </tr>
                      {row.errors.length > 0 && (
                        <tr>
                          <td colSpan="5" className="billing-row-error">
                            {row.errors.join(" · ")}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="settings-grid">
            <section className="card guide">
              <h2>Backblaze pricing</h2>
              <p>
                First 10 GB free. Additional storage uses the published B2
                Fundamentals pay-as-you-go rate of $6.95/TB per 30 days. The
                free allowance applies once across all buckets.
              </p>
              <p>
                Backblaze calculates storage invoices from byte-hours over the
                billing period. Contract discounts, tax and usage changes can
                affect the final amount.
              </p>
              <p>
                Downloads have free egress up to 3× average monthly storage,
                then $0.01/GB where partner exemptions do not apply. This
                storage projection covers the scanned stored data. Download/API
                charges are available in your Backblaze account.
              </p>
              <small>Published rate verified {data.pricing.verifiedOn}.</small>
              <div className="form-actions">
                <button
                  onClick={() =>
                    api
                      .openPricing()
                      .catch((failure) => setError(failure.message))
                  }
                >
                  <ExternalLink size={15} />
                  Official pricing
                </button>
                <button
                  onClick={() =>
                    api
                      .openBackblaze()
                      .catch((failure) => setError(failure.message))
                  }
                >
                  Backblaze dashboard
                </button>
              </div>
            </section>
            <section className="card guide">
              <h2>Local budget alert</h2>
              <p>
                Show an alert when this storage projection exceeds your budget.
              </p>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  try {
                    await api.setBillingBudget(Number(budget || 0));
                    setSaved(true);
                  } catch (failure) {
                    setError(failure.message);
                  }
                }}
              >
                <label>
                  Monthly storage budget in USD
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={budget}
                    onChange={(event) => {
                      setBudget(event.target.value);
                      setSaved(false);
                    }}
                    placeholder="0 disables the alert"
                  />
                </label>
                <button type="submit">Save budget</button>
                {saved && (
                  <small role="status">Budget saved on this Mac.</small>
                )}
              </form>
              <p>
                Removing a current file can leave retained versions stored.
                Review Versions & deleted and your bucket lifecycle rules when
                reducing storage.
              </p>
            </section>
          </div>
        </>
      )}
    </>
  );
}
function Metric({ icon: Icon, label, value, note }) {
  return (
    <div className="stat">
      <div>
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
