import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Martina — PhD Tracker</h1>
      <p style={{ color: "#475569", marginBottom: 24 }}>
        Weekly research progress, summarised for you and shareable with your
        supervisor.
      </p>
      <Link
        href="/dashboard"
        style={{
          display: "inline-block",
          background: "#111827",
          color: "#fff",
          padding: "10px 16px",
          borderRadius: 8,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Open this week&apos;s dashboard →
      </Link>
    </main>
  );
}
