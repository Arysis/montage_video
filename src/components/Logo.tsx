import Link from "next/link";
import { appName } from "@/lib/brand";

export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        background: "var(--color-primary)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      <svg width={size / 2} height={size / 2} viewBox="0 0 256 256">
        <path d="M72 40v176l144-88z" fill="var(--color-bg)" />
      </svg>
    </span>
  );
}

export function Logo({
  href = "/",
  size = 24,
  fontSize = 16,
}: {
  href?: string;
  size?: number;
  fontSize?: number;
}) {
  return (
    <Link
      href={href}
      style={{ display: "inline-flex", alignItems: "center", gap: 12, textDecoration: "none" }}
    >
      <LogoMark size={size} />
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize, lineHeight: 1.4 }}>
        {appName()}
      </span>
    </Link>
  );
}
