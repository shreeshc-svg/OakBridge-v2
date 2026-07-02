import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, requireAdmin = false }) {
    const { isAuthenticated, isAdmin, loading } = useAuth();
    const loc = useLocation();

    if (loading) {
        return (
            <div
                data-testid="auth-loading"
                className="py-32 text-center font-mono text-xs text-[#4B5563]"
            >
                Checking session…
            </div>
        );
    }
    if (!isAuthenticated) {
        return <Navigate to="/login" state={{ from: loc }} replace />;
    }
    if (requireAdmin && !isAdmin) {
        return (
            <div className="py-32 px-6 text-center">
                <h1 className="font-serif text-4xl text-[#002B5C]">
                    Restricted.
                </h1>
                <p className="mt-4 text-[#4B5563]">
                    This area is reserved for administrators.
                </p>
            </div>
        );
    }
    return children;
}
