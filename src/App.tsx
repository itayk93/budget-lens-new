import { ReactNode, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Index from "./pages/Index";
import MonthsManager from "./pages/MonthsManager";
import PendingTransactions from "./pages/PendingTransactions";
import Login from "./pages/Login";
import FoodMap from "./pages/FoodMap";
import Flights from "./pages/Flights";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import PwaBootstrap from "./components/pwa/PwaBootstrap";
import AppLoadingScreen from "./components/AppLoadingScreen";

const queryClient = new QueryClient();

/* Without a session every Supabase query comes back empty and the pages render blank,
   so send anyone who isn't signed in straight to the login screen. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AppLoadingScreen />;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

const App = () => {
  useEffect(() => {
    // Disable mouse wheel value changing on all number & decimal inputs across the entire site
    const handleWheel = () => {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement &&
        (el.type === "number" || el.inputMode === "decimal" || el.inputMode === "numeric")
      ) {
        el.blur();
      }
    };
    window.addEventListener("wheel", handleWheel, { passive: true });
    return () => window.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <PwaBootstrap />
      <AuthProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* Public on purpose: the point of the map is a link you can share. */}
            {/* Personal spending geography — signed-in owner only. */}
            <Route path="/food-map" element={<RequireAuth><FoodMap /></RequireAuth>} />
            <Route path="/flights" element={<RequireAuth><Flights /></RequireAuth>} />
            <Route path="/" element={<RequireAuth><Index /></RequireAuth>} />
            <Route path="/months" element={<RequireAuth><MonthsManager /></RequireAuth>} />
            <Route path="/pending-transactions" element={<RequireAuth><PendingTransactions /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
