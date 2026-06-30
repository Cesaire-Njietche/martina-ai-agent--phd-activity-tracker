import { getSupabase } from "@/lib/supabase";
import { notFound } from "next/navigation";

// Rendered fresh per request, server-side. No auth: the only credential is the
// share token in the URL, looked up directly against weekly_reports.
export const dynamic = "force-dynamic";

type Report = {
  student_id: string | null;
  week_start: string;
  narrative: string | null;
  paper_count: number | null;
  coding_hours: number | null;
};

export default async function ReportPage({
  params,
}: {
  params: { token: string };
}) {
  const sb = getSupabase();
  const { data } = await sb
    .from("weekly_reports")
    .select("student_id, week_start, narrative, paper_count, coding_hours")
    .eq("share_token", params.token)
    .limit(1);

  const report = (data?.[0] as Report | undefined) ?? null;
  if (!report) notFound();

  const paragraphs = (report.narrative ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
        Weekly research progress report
      </p>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>
        {report.student_id || "Unknown student"}
      </h1>
      <p style={{ color: "#475569", margin: "0 0 24px" }}>
        Week of {report.week_start}
      </p>

      <div style={statRow}>
        <Stat label="Papers read" value={String(report.paper_count ?? 0)} />
        <Stat
          label="Coding hours"
          value={(report.coding_hours ?? 0).toString()}
        />
      </div>

      <article
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: "28px 32px",
          marginTop: 24,
          fontSize: 16,
          color: "#1e293b",
        }}
      >
        {paragraphs.length ? (
          paragraphs.map((p, i) => (
            <p key={i} style={{ margin: i === 0 ? "0 0 16px" : "16px 0" }}>
              {p}
            </p>
          ))
        ) : (
          <p style={{ margin: 0, color: "#64748b" }}>
            No narrative was recorded for this week.
          </p>
        )}
      </article>

      <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 24 }}>
        Shared via Martina — no account required to view this report.
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        flex: 1,
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: "16px 20px",
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      <div style={{ color: "#64748b", fontSize: 13 }}>{label}</div>
    </div>
  );
}

const statRow: React.CSSProperties = {
  display: "flex",
  gap: 16,
  marginTop: 8,
};
