export default function AppLoadingScreen() {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, #F6F8FC 0%, #EEF3FB 100%)",
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Heebo, sans-serif",
        direction: "rtl",
        padding: 24,
      }}
    >
      <div className="app-loading-shell" aria-live="polite" aria-busy="true">
        <div className="app-loading-mark" aria-hidden="true">
          <div className="app-loading-ring" />
          <div className="app-loading-ring app-loading-ring-delay" />
          <div className="app-loading-core" />
        </div>
        <div className="app-loading-copy">
          <strong>טוען את התקציב</strong>
          <span>רגע קטן</span>
        </div>
      </div>
    </div>
  );
}
