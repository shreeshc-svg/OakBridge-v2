import React, {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    useCallback,
} from "react";
import { authLogin, authMe, authRegister } from "../lib/api";
import { ADMIN_ROLES, isSuperadmin } from "../lib/rbac";

const AuthContext = createContext(null);
const TOKEN_KEY = "oakbridge_token";

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null); // null = unknown/loading, false = logged out, object = logged in
    const [loading, setLoading] = useState(true);

    const loadMe = useCallback(async () => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) {
            setUser(false);
            setLoading(false);
            return;
        }
        try {
            const u = await authMe();
            setUser(u);
        } catch {
            localStorage.removeItem(TOKEN_KEY);
            setUser(false);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadMe();
    }, [loadMe]);

    const login = useCallback(async (email, password) => {
        const data = await authLogin(email, password);
        localStorage.setItem(TOKEN_KEY, data.access_token);
        setUser(data.user);
        return data.user;
    }, []);

    const register = useCallback(async (payload) => {
        const data = await authRegister(payload);
        localStorage.setItem(TOKEN_KEY, data.access_token);
        setUser(data.user);
        return data.user;
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem(TOKEN_KEY);
        setUser(false);
    }, []);

    const value = useMemo(
        () => ({
            user: user || null,
            isAuthenticated: !!user && user !== false,
            // Any admin tier — not just the legacy "admin" role — may enter /admin.
            // What they can do inside is decided per-section by lib/rbac.
            isAdmin: !!user && ADMIN_ROLES.includes(user.role),
            isSuperadmin: !!user && isSuperadmin(user.role),
            loading,
            login,
            register,
            logout,
            refresh: loadMe,
        }),
        [user, loading, login, register, logout, loadMe],
    );

    return (
        <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    );
}

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
    return ctx;
};
