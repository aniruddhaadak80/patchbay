import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Patchbay — agent routing patchbay";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** OG card: the rack face with three tier jacks and a cord path. */
export default function OpenGraphImage() {
  const lanes = [
    { y: 210, label: "FAST", price: "$0.28 /MTok" },
    { y: 320, label: "BALANCED", price: "$1.25 /MTok" },
    { y: 430, label: "DEEP", price: "$3.00 /MTok" },
  ];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0d1014",
          padding: "64px 72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                border: "2px solid #c08a2e",
                background: "#1b2128",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{ width: 14, height: 14, borderRadius: 99, background: "#d9a441" }} />
            </div>
            <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, color: "#a49b88" }}>
              AGENT ROUTING BAY
            </div>
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 68,
              fontWeight: 800,
              color: "#f4efe2",
              lineHeight: 1.05,
              letterSpacing: -1.5,
            }}
          >
            Route every task to the
          </div>
          <div style={{ fontSize: 68, fontWeight: 800, color: "#d9a441", lineHeight: 1.05, letterSpacing: -1.5 }}>
            model that should handle it.
          </div>
          <div style={{ marginTop: 22, fontSize: 26, color: "#ded7c6", maxWidth: 900, lineHeight: 1.4 }}>
            Live pricing from OpenRouter and models.dev. Deterministic routing score. Sealed audit chain.
          </div>
        </div>

        <div style={{ display: "flex", gap: 18 }}>
          {lanes.map((lane) => (
            <div
              key={lane.label}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 18,
                border: "1px solid #2f3944",
                background: "#14181e",
                borderRadius: 8,
                padding: "20px 22px",
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 99,
                  background: "#3a2c12",
                  border: "2px solid #d9a441",
                }}
              />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 18, letterSpacing: 4, color: "#a49b88" }}>{lane.label}</div>
                <div style={{ fontSize: 30, color: "#f4efe2" }}>{lane.price}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", fontSize: 24, color: "#a49b88" }}>
          github.com/aniruddhaadak80/patchbay
        </div>
      </div>
    ),
    { ...size },
  );
}