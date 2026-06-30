import { getSupabase } from "@/lib/supabase";
import { domainChips, DomainChip } from "@/lib/domains";
import CopyLinkButton from "@/components/CopyLinkButton";

export const dynamic = "force-dynamic";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Formatted in UTC so the displayed day matches the per-UTC-day dedup hash
// (the same paper read on different days is intentionally a separate card).
const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function formatDate(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "" : DATE_FMT.format(d);
}

type PaperRow = {
  title: string;
  minutes: number;
  seconds: number;
  chips: DomainChip[];
  dateLabel: string;
};

export default async function DashboardPage() {
  const sb = getSupabase();

  // Rolling window: the last 7 days ending now — not week/Monday aligned.
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const until = now.toISOString();
  const sinceLabel = since.slice(0, 10);
  const untilLabel = until.slice(0, 10);

  // The most recent generated report supplies the student scope and the
  // supervisor share link (report generation is still weekly).
  const { data: reports } = await sb
    .from("weekly_reports")
    .select("student_id, share_token")
    .order("week_start", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  const report = reports?.[0] ?? null;
  const studentId: string = report?.student_id ?? "";
  const shareToken: string | null = report?.share_token ?? null;

  // Papers read in the last 7 days (those carrying a title), with their domains
  // looked up from paper_classifications by event id.
  let paperQuery = sb
    .from("unified_events")
    .select("id, metadata, engaged_secs, timestamp")
    .eq("activity_type", "paper_read")
    .gte("timestamp", since)
    .lte("timestamp", until);
  if (studentId) paperQuery = paperQuery.eq("student_id", studentId);
  const { data: paperEvents } = await paperQuery;

  const titled = (paperEvents ?? []).filter((e) =>
    Boolean(((e.metadata ?? {}) as Record<string, unknown>).title)
  );
  const eventIds = titled.map((e) => e.id as number);

  const domainsByEvent = new Map<number, string[]>();
  if (eventIds.length) {
    const { data: classRows } = await sb
      .from("paper_classifications")
      .select("event_id, domains")
      .in("event_id", eventIds);
    for (const c of classRows ?? []) {
      domainsByEvent.set(c.event_id as number, (c.domains as string[]) ?? []);
    }
  }

  const papers: PaperRow[] = titled
    .map((e) => {
      const seconds = Number(e.engaged_secs) || 0;
      const meta = (e.metadata ?? {}) as Record<string, unknown>;
      return {
        title: String(meta.title ?? "(untitled)"),
        minutes: Math.round(seconds / 60),
        seconds,
        chips: domainChips(domainsByEvent.get(e.id as number)),
        dateLabel: formatDate(e.timestamp as string),
      };
    })
    .sort((a, b) => b.seconds - a.seconds);

  const readingHours = round2(papers.reduce((s, p) => s + p.seconds, 0) / 3600);

  // Writing hours: latex_writing engagement in the last 7 days.
  let writingQuery = sb
    .from("unified_events")
    .select("engaged_secs")
    .eq("activity_type", "latex_writing")
    .gte("timestamp", since)
    .lte("timestamp", until);
  if (studentId) writingQuery = writingQuery.eq("student_id", studentId);
  const { data: writingRows } = await writingQuery;
  const writingHours = round2(
    (writingRows ?? []).reduce((s, w) => s + (Number(w.engaged_secs) || 0), 0) / 3600
  );

  // Coding hours by language in the last 7 days.
  let codingQuery = sb
    .from("unified_events")
    .select("engaged_secs, metadata")
    .eq("activity_type", "coding")
    .gte("timestamp", since)
    .lte("timestamp", until);
  if (studentId) codingQuery = codingQuery.eq("student_id", studentId);
  const { data: codingRows } = await codingQuery;

  const codingByLangSecs = new Map<string, number>();
  for (const c of codingRows ?? []) {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const lang = String(meta.language ?? "") || "unknown";
    codingByLangSecs.set(lang, (codingByLangSecs.get(lang) ?? 0) + (Number(c.engaged_secs) || 0));
  }
  const codingByLang = Array.from(codingByLangSecs.entries())
    .map(([lang, secs]) => ({ lang, hours: round2(secs / 3600) }))
    .sort((a, b) => b.hours - a.hours);
  const codingTotal = round2(
    Array.from(codingByLangSecs.values()).reduce((s, v) => s + v, 0) / 3600
  );

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, margin: "0 0 4px" }}>Last 7 days</h1>
          <p style={{ color: "#475569", margin: 0 }}>
            {studentId ? `${studentId} · ` : ""}
            {sinceLabel} → {untilLabel}
          </p>
        </div>
        <CopyLinkButton token={shareToken} />
      </div>

      {/* Summary */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginTop: 24 }}>
        <SummaryCard label="Papers read" value={String(papers.length)} />
        <SummaryCard label="Reading hours" value={String(readingHours)} />
        <SummaryCard label="Writing hours" value={String(writingHours)} />
        <SummaryCard label="Coding hours" value={String(codingTotal)} />
      </section>

      <section style={{ marginTop: 8 }}>
        <h2 style={{ fontSize: 14, color: "#64748b", fontWeight: 600, margin: "20px 0 8px" }}>
          Coding by language
        </h2>
        {codingByLang.length ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {codingByLang.map((c) => (
              <span key={c.lang} style={pill}>
                {c.lang} — {c.hours} h
              </span>
            ))}
          </div>
        ) : (
          <p style={{ color: "#94a3b8", margin: 0 }}>No coding recorded this week.</p>
        )}
      </section>

      {/* Papers */}
      <h2 style={{ fontSize: 18, margin: "32px 0 12px" }}>Papers</h2>
      {papers.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {papers.map((p, i) => (
            <div key={i} style={paperCard}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{p.title}</div>
                {p.dateLabel && (
                  <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                    {p.dateLabel}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {p.chips.map((c) => (
                    <span
                      key={c.label}
                      style={{
                        background: c.bg,
                        color: c.fg,
                        borderRadius: 999,
                        padding: "2px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ color: "#475569", fontSize: 14, whiteSpace: "nowrap", marginLeft: 12 }}>
                {p.minutes} min
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ color: "#94a3b8" }}>No papers recorded for this week.</p>
      )}
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 20px" }}>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{value}</div>
      <div style={{ color: "#64748b", fontSize: 13 }}>{label}</div>
    </div>
  );
}

const pill: React.CSSProperties = {
  background: "#eef2ff",
  color: "#3730a3",
  borderRadius: 999,
  padding: "4px 12px",
  fontSize: 13,
  fontWeight: 600,
};

const paperCard: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: "14px 18px",
};
