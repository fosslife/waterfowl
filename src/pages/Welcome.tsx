import { Button } from "../components/ui/Button";
import { Link } from "react-router-dom";
import { Database, Zap, Shield, Terminal } from "lucide-react";

export function Welcome() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 48,
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background grid pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.05,
          backgroundImage: `
          linear-gradient(rgba(0,243,255,0.3) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,243,255,0.3) 1px, transparent 1px)
        `,
          backgroundSize: "40px 40px",
        }}
      />

      {/* Animated accent circle */}
      <div
        style={{
          position: "absolute",
          width: 384,
          height: 384,
          borderRadius: "50%",
          opacity: 0.1,
          background:
            "radial-gradient(circle, var(--color-accent-primary) 0%, transparent 70%)",
          animation: "pulse-slow 4s ease-in-out infinite",
        }}
      />

      <div style={{ position: "relative", zIndex: 10 }}>
        {/* Icon with glow effect */}
        <div
          style={{
            marginBottom: 32,
            position: "relative",
            display: "inline-block",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 8,
              opacity: 0.3,
              filter: "blur(20px)",
              background: "var(--color-accent-primary)",
            }}
          />
          <div
            style={{
              position: "relative",
              padding: 24,
              borderRadius: 8,
              border: "2px solid var(--color-accent-primary)",
              background:
                "linear-gradient(135deg, var(--color-base-100) 0%, var(--color-base-50) 100%)",
              boxShadow: "var(--shadow-glow-strong)",
            }}
          >
            <Database
              size={56}
              style={{ color: "var(--color-accent-primary)" }}
            />
          </div>
        </div>

        <h1
          style={{
            fontSize: "var(--text-3xl)",
            fontWeight: "var(--weight-bold)",
            marginBottom: 12,
            background:
              "linear-gradient(135deg, var(--color-text-primary) 0%, var(--color-accent-primary) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Welcome to Waterfowl
        </h1>

        <p
          style={{
            marginBottom: 32,
            maxWidth: 400,
            margin: "0 auto 32px",
            fontSize: "var(--text-base)",
            lineHeight: 1.6,
            color: "var(--color-text-secondary)",
          }}
        >
          A precision database management tool for PostgreSQL. Fast, secure, and
          built for power users.
        </p>

        {/* Feature pills */}
        <div
          style={{
            display: "flex",
            gap: 16,
            justifyContent: "center",
            marginBottom: 40,
            flexWrap: "wrap",
          }}
        >
          <FeaturePill icon={<Zap size={14} />} text="Lightning Fast" />
          <FeaturePill icon={<Shield size={14} />} text="Secure by Default" />
          <FeaturePill icon={<Terminal size={14} />} text="Raw SQL Access" />
        </div>

        <Link to="/new-connection">
          <Button size="lg">Create First Connection</Button>
        </Link>

        <p
          style={{
            marginTop: 16,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-tertiary)",
          }}
        >
          PostgreSQL 12+ supported
        </p>
      </div>

      <style>{`
        @keyframes pulse-slow {
          0%, 100% { transform: scale(1); opacity: 0.1; }
          50% { transform: scale(1.1); opacity: 0.15; }
        }
      `}</style>
    </div>
  );
}

function FeaturePill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 9999,
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-medium)",
        background: "var(--color-base-100)",
        border: "1px solid var(--border-subtle)",
        color: "var(--color-text-secondary)",
      }}
    >
      <span style={{ color: "var(--color-accent-primary)" }}>{icon}</span>
      {text}
    </div>
  );
}
