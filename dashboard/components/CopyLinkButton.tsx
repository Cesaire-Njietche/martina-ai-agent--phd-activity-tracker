"use client";

import { useState } from "react";

/**
 * Copies the supervisor-shareable report URL for the given token to the
 * clipboard. The URL is built from the current origin at click time so it works
 * the same locally and on the deployed domain.
 */
export default function CopyLinkButton({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!token) {
    return (
      <button disabled style={{ ...buttonStyle, opacity: 0.5, cursor: "not-allowed" }}>
        No report yet
      </button>
    );
  }

  async function copy() {
    const url = `${window.location.origin}/report/${token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for non-secure contexts / older browsers.
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button onClick={copy} style={buttonStyle}>
      {copied ? "Copied ✓" : "Copy supervisor link"}
    </button>
  );
}

const buttonStyle: React.CSSProperties = {
  background: "#111827",
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  padding: "10px 16px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
