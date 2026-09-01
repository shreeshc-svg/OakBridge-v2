import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import NoIndex from "@/components/NoIndex";
import Home from "@/pages/Home";
import Catalog from "@/pages/Catalog";
import BookDetail from "@/pages/BookDetail";
import Cart from "@/pages/Cart";
import Checkout from "@/pages/Checkout";
import OrderConfirmation from "@/pages/OrderConfirmation";
import About from "@/pages/About";
import Solutions from "@/pages/Solutions";
import Gifting from "@/pages/Gifting";
import { captureAttribution } from "@/lib/attribution";
import Contact from "@/pages/Contact";
import Authors from "@/pages/Authors";
import Account from "@/pages/Account";
import PaymentFailed from "@/pages/PaymentFailed";
import ResumePayment from "@/pages/ResumePayment";
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import ResetPassword from "@/pages/auth/ResetPassword";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminBooks from "@/pages/admin/AdminBooks";
import AdminHampers from "@/pages/admin/AdminHampers";
import AdminOrders from "@/pages/admin/AdminOrders";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminWaitlists from "@/pages/admin/AdminWaitlists";
import AdminCoupons from "@/pages/admin/AdminCoupons";
import AdminInventory from "@/pages/admin/AdminInventory";
import AdminSubmissions from "@/pages/admin/AdminSubmissions";
import AdminSpam from "@/pages/admin/AdminSpam";
import AdminAudit from "@/pages/admin/AdminAudit";
import AdminMedia from "@/pages/admin/AdminMedia";
import AdminPages from "@/pages/admin/AdminPages";
import AdminNavigation from "@/pages/admin/AdminNavigation";
import AdminSettings from "@/pages/admin/AdminSettings";
import AdminPLP from "@/pages/admin/AdminPLP";
import AdminPDP from "@/pages/admin/AdminPDP";
import AdminAuthors from "@/pages/admin/AdminAuthors";
import AdminCareers from "@/pages/admin/AdminCareers";
import AdminMediaGallery from "@/pages/admin/AdminMediaGallery";
import AdminLegal from "@/pages/admin/AdminLegal";
import AdminMessages from "@/pages/admin/AdminMessages";
import AdminEbooks from "@/pages/admin/AdminEbooks";
import NotFound from "@/pages/NotFound";
import Submissions from "@/pages/Submissions";
import Careers from "@/pages/Careers";
import MediaGallery from "@/pages/MediaGallery";
import Verticals from "@/pages/Verticals";
import LegalPage from "@/pages/LegalPage";
import Events from "@/pages/Events";
import DigitalSolutions from "@/pages/DigitalSolutions";
import Academy from "@/pages/Academy";
import { CartProvider } from "@/context/CartContext";
import { AuthProvider } from "@/context/AuthContext";

/*
 * Read the campaign tags off the landing URL before anything navigates away.
 *
 * At module scope rather than in an effect: this must happen once, on the first
 * URL the visitor arrived at, and an effect in StrictMode runs twice while a
 * router redirect can replace the query string before it ever fires.
 * captureAttribution is first-touch and self-guarding, so a second call is a
 * no-op either way.
 */
captureAttribution();

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
                                {/* Transactional routes are wrapped in <NoIndex> so
                                    every render branch carries the tag — see
                                    components/NoIndex.jsx for why this lives here
                                    and not inside the page components. */}
                                <Route
                                    path="/cart"
                                    element={
                                        <>
                                            <NoIndex title="Your Cart" />
                                            <Cart />
                                        </>
                                    }
                                />
                                <Route
                                    path="/checkout"
                                    element={
                                        <>
                                            {/* Outside ProtectedRoute on purpose: it
                                                does `return children`, so two children
                                                would make it return an unkeyed array. */}
                                            <NoIndex title="Checkout" />
                                            <ProtectedRoute>
                                                <Checkout />
                                            </ProtectedRoute>
                                        </>
                                    }
                                />
                                <Route
                                    path="/order-confirmation/:id"
                                    element={
                                        <>
                                            <NoIndex title="Order Confirmation" />
                                            <OrderConfirmation />
                                        </>
                                    }
                                />
                                <Route path="/about" element={<About />} />
                                <Route path="/gifting" element={<Gifting />} />
                                <Route path="/solutions" element={<Solutions />} />
                                <Route
                                    path="/solutions/:slug"
                                    element={<Solutions />}
                                />
                                <Route path="/contact" element={<Contact />} />
                                <Route path="/authors" element={<Authors />} />
                                <Route path="/authors/:id" element={<Authors />} />
                                <Route path="/submissions" element={<Submissions />} />
                                <Route path="/careers" element={<Careers />} />
                                <Route path="/media" element={<MediaGallery />} />
                                <Route path="/what-we-do" element={<Verticals />} />
                                <Route path="/events" element={<Events />} />
                                <Route path="/digital-solutions" element={<DigitalSolutions />} />
                                <Route path="/academy" element={<Academy />} />
                                <Route path="/terms" element={<LegalPage slug="terms" />} />
                                <Route path="/privacy" element={<LegalPage slug="privacy" />} />
                                <Route path="/refund-policy" element={<LegalPage slug="refund" />} />
                                <Route path="/shipping-policy" element={<LegalPage slug="shipping" />} />
                                <Route path="/cookie-policy" element={<LegalPage slug="cookie" />} />
                                {/* Opened from an emailed payment link. NoIndex is
                                    set inside the page, which also covers the
                                    expired-link and already-paid states. */}
                                <Route path="/pay/:id" element={<ResumePayment />} />
                                <Route
                                    path="/payment-failed/:id"
                                    element={
                                        <>
                                            <NoIndex title="Payment Unsuccessful" />
                                            <PaymentFailed />
                                        </>
                                    }
                                />
                                {/* Auth screens: no search value, and /reset-password
                                    carries a token in the query string that must never
                                    reach an index. */}
                                <Route
                                    path="/login"
                                    element={
                                        <>
                                            <NoIndex title="Sign In" />
                                            <Login />
                                        </>
                                    }
                                />
                                <Route
                                    path="/register"
                                    element={
                                        <>
                                            <NoIndex title="Create an Account" />
                                            <Register />
                                        </>
                                    }
                                />
                                <Route
                                    path="/forgot-password"
                                    element={
                                        <>
                                            <NoIndex title="Forgot Password" />
                                            <ForgotPassword />
                                        </>
                                    }
                                />
                                <Route
                                    path="/reset-password"
                                    element={
                                        <>
                                            <NoIndex title="Reset Password" />
                                            <ResetPassword />
                                        </>
                                    }
                                />
                                <Route
                                    path="/account"
                                    element={
                                        <>
                                            <NoIndex title="My Account" />
                                            <ProtectedRoute>
                                                <Account />
                                            </ProtectedRoute>
                                        </>
                                    }
                                />
                                {/* Catch-all: without this, any unknown URL (incl. every
                                    stale link still in Google from the previous site)
                                    rendered a blank page. */}
                                <Route path="*" element={<NotFound />} />
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
                                <Route path="hampers" element={<AdminHampers />} />
                                <Route path="orders" element={<AdminOrders />} />
                                <Route path="users" element={<AdminUsers />} />
                                <Route path="waitlists" element={<AdminWaitlists />} />
                                <Route path="coupons" element={<AdminCoupons />} />
                                <Route path="inventory" element={<AdminInventory />} />
                                <Route path="submissions" element={<AdminSubmissions />} />
                                <Route path="spam" element={<AdminSpam />} />
                                <Route path="audit" element={<AdminAudit />} />
                                <Route path="pages" element={<AdminPages />} />
                                <Route path="navigation" element={<AdminNavigation />} />
                                <Route path="media" element={<AdminMedia />} />
                                <Route path="ebooks" element={<AdminEbooks />} />
                                <Route path="page-bookstore" element={<AdminPLP />} />
                                <Route path="page-book" element={<AdminPDP />} />
                                <Route path="authors" element={<AdminAuthors />} />
                                <Route path="careers" element={<AdminCareers />} />
                                <Route path="media-gallery" element={<AdminMediaGallery />} />
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
