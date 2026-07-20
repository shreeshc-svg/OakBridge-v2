import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import Home from "@/pages/Home";
import Catalog from "@/pages/Catalog";
import BookDetail from "@/pages/BookDetail";
import Cart from "@/pages/Cart";
import Checkout from "@/pages/Checkout";
import OrderConfirmation from "@/pages/OrderConfirmation";
import About from "@/pages/About";
import Solutions from "@/pages/Solutions";
import Contact from "@/pages/Contact";
import Authors from "@/pages/Authors";
import Account from "@/pages/Account";
import PaymentFailed from "@/pages/PaymentFailed";
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import ResetPassword from "@/pages/auth/ResetPassword";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminBooks from "@/pages/admin/AdminBooks";
import AdminOrders from "@/pages/admin/AdminOrders";
import AdminDeskCopies from "@/pages/admin/AdminDeskCopies";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminWaitlists from "@/pages/admin/AdminWaitlists";
import AdminCoupons from "@/pages/admin/AdminCoupons";
import AdminInventory from "@/pages/admin/AdminInventory";
import AdminSubmissions from "@/pages/admin/AdminSubmissions";
import AdminMedia from "@/pages/admin/AdminMedia";
import AdminPages from "@/pages/admin/AdminPages";
import AdminNavigation from "@/pages/admin/AdminNavigation";
import AdminSettings from "@/pages/admin/AdminSettings";
import AdminPLP from "@/pages/admin/AdminPLP";
import AdminPDP from "@/pages/admin/AdminPDP";
import AdminLegal from "@/pages/admin/AdminLegal";
import AdminMessages from "@/pages/admin/AdminMessages";
import Submissions from "@/pages/Submissions";
import Verticals from "@/pages/Verticals";
import LegalPage from "@/pages/LegalPage";
import Events from "@/pages/Events";
import DigitalSolutions from "@/pages/DigitalSolutions";
import Academy from "@/pages/Academy";
import { CartProvider } from "@/context/CartContext";
import { AuthProvider } from "@/context/AuthContext";

function App() {
    return (
        <div className="App">
            <AuthProvider>
                <CartProvider>
                    <BrowserRouter>
                        <Routes>
                            <Route element={<Layout />}>
                                <Route path="/" element={<Home />} />
                                <Route path="/books" element={<Catalog />} />
                                <Route path="/books/:id" element={<BookDetail />} />
                                <Route path="/cart" element={<Cart />} />
                                <Route
                                    path="/checkout"
                                    element={
                                        <ProtectedRoute>
                                            <Checkout />
                                        </ProtectedRoute>
                                    }
                                />
                                <Route
                                    path="/order-confirmation/:id"
                                    element={<OrderConfirmation />}
                                />
                                <Route path="/about" element={<About />} />
                                <Route path="/solutions" element={<Solutions />} />
                                <Route
                                    path="/solutions/:slug"
                                    element={<Solutions />}
                                />
                                <Route path="/contact" element={<Contact />} />
                                <Route path="/authors" element={<Authors />} />
                                <Route path="/authors/:id" element={<Authors />} />
                                <Route path="/submissions" element={<Submissions />} />
                                <Route path="/what-we-do" element={<Verticals />} />
                                <Route path="/events" element={<Events />} />
                                <Route path="/digital-solutions" element={<DigitalSolutions />} />
                                <Route path="/academy" element={<Academy />} />
                                <Route path="/terms" element={<LegalPage slug="terms" />} />
                                <Route path="/privacy" element={<LegalPage slug="privacy" />} />
                                <Route path="/refund-policy" element={<LegalPage slug="refund" />} />
                                <Route path="/shipping-policy" element={<LegalPage slug="shipping" />} />
                                <Route path="/cookie-policy" element={<LegalPage slug="cookie" />} />
                                <Route path="/payment-failed/:id" element={<PaymentFailed />} />
                                <Route path="/login" element={<Login />} />
                                <Route path="/register" element={<Register />} />
                                <Route path="/forgot-password" element={<ForgotPassword />} />
                                <Route path="/reset-password" element={<ResetPassword />} />
                                <Route
                                    path="/account"
                                    element={
                                        <ProtectedRoute>
                                            <Account />
                                        </ProtectedRoute>
                                    }
                                />
                            </Route>
                            <Route
                                path="/admin"
                                element={
                                    <ProtectedRoute requireAdmin>
                                        <AdminLayout />
                                    </ProtectedRoute>
                                }
                            >
                                <Route index element={<AdminDashboard />} />
                                <Route path="books" element={<AdminBooks />} />
                                <Route path="orders" element={<AdminOrders />} />
                                <Route
                                    path="desk-copies"
                                    element={<AdminDeskCopies />}
                                />
                                <Route path="users" element={<AdminUsers />} />
                                <Route path="waitlists" element={<AdminWaitlists />} />
                                <Route path="coupons" element={<AdminCoupons />} />
                                <Route path="inventory" element={<AdminInventory />} />
                                <Route path="submissions" element={<AdminSubmissions />} />
                                <Route path="pages" element={<AdminPages />} />
                                <Route path="navigation" element={<AdminNavigation />} />
                                <Route path="media" element={<AdminMedia />} />
                                <Route path="page-bookstore" element={<AdminPLP />} />
                                <Route path="page-book" element={<AdminPDP />} />
                                <Route path="messages" element={<AdminMessages />} />
                                <Route path="legal" element={<AdminLegal />} />
                                <Route path="settings" element={<AdminSettings />} />
                            </Route>
                        </Routes>
                    </BrowserRouter>
                </CartProvider>
            </AuthProvider>
        </div>
    );
}

export default App;
