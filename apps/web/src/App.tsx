import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthContext";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import { BuildingsPage } from "@/pages/BuildingsPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { DeviceDetailPage } from "@/pages/DeviceDetailPage";
import { DevicesPage } from "@/pages/DevicesPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { ImportPage } from "@/pages/ImportPage";
import { LoginPage } from "@/pages/LoginPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { RoomsPage } from "@/pages/RoomsPage";
import { StaffPage } from "@/pages/StaffPage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/rooms" element={<RoomsPage />} />
              <Route path="/buildings" element={<BuildingsPage />} />
              <Route element={<ProtectedRoute roles={["admin", "operator"]} />}>
                <Route path="/devices" element={<DevicesPage />} />
                <Route path="/devices/:id" element={<DeviceDetailPage />} />
                <Route path="/staff" element={<StaffPage />} />
                <Route path="/import" element={<ImportPage />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
