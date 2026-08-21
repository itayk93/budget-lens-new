import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/riseup/components";
import { useAuth } from "@/hooks/useAuth";
import { RISE } from "@/riseup/compute";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Go back to whatever page the guard bounced us from, or to the cash flow itself.
  const target = (location.state as { from?: string } | null)?.from || "/";

  useEffect(() => {
    if (!loading && user) navigate(target, { replace: true });
  }, [loading, navigate, target, user]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await signIn(email, password);
    if (signInError) {
      setError(signInError.message || "ההתחברות נכשלה");
      setSubmitting(false);
      return;
    }
    navigate(target, { replace: true });
  };

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: RISE.cream, fontFamily: "Heebo, sans-serif", textAlign: "right", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 480, minHeight: "100vh", background: "#fff", padding: 16, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 30px rgba(0,0,0,0.06)" }}>
        <Card>
          <form onSubmit={handleSubmit} style={{ padding: 24, display: "grid", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 12 }}>
              <div style={{ width: 88, height: 88, borderRadius: 22, overflow: "hidden", boxShadow: "0 6px 16px rgba(60, 113, 197, 0.25)", marginBottom: 14 }}>
                <img src="/logo.png" alt="Budget Lens" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#202125", letterSpacing: "-0.5px" }}>Budget Lens</h1>
              <p style={{ margin: "4px 0 0", color: "#6B7280", fontSize: 14, fontWeight: 500 }}>
                התחברות למערכת ניהול תקציב חכם
              </p>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 14, color: "#374151" }}>אימייל</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                style={{ border: "1px solid #D1D5DB", borderRadius: 12, padding: "12px 14px", fontSize: 16, background: "#fff" }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 14, color: "#374151" }}>סיסמה</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                style={{ border: "1px solid #D1D5DB", borderRadius: 12, padding: "12px 14px", fontSize: 16, background: "#fff" }}
              />
            </label>

            {error && (
              <div style={{ color: "#991B1B", background: "#FEF2F2", borderRadius: 12, padding: "12px 14px", fontSize: 14 }}>
                {error}
              </div>
            )}

            <Button type="submit" disabled={submitting || loading} className="w-full">
              {submitting ? "מתחבר..." : "התחברות"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
