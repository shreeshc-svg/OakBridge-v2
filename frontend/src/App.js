import React, { lazy, Suspense } from "react";
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
import { captureAttribution, sendVisitBeacon } from "@/lib/attribution";
import { API } from "@/lib/api";
import Contact from "@/pages/Contact";
import Authors from "@/pages/Authors";
import Account from "@/pages/Account";
import PaymentFailed from "@/pages/PaymentFailed";
import ResumePayment from "@/pages/ResumePayment";
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import ResetPassword from "@/pages/auth/ResetPassword";
import Unsubscribe from "@/pages/Unsubscribe";
import SubscribeConfirm from "@/pages/SubscribeConfirm";
import NotFound from "@/pages/NotFound";
import WriterRedirect from "@/pages/WriterRedirect";
import Submissions from "@/pages/Submissions";
import Careers from "@/pages/Careers";
import MediaGallery from "@/pages/MediaGallery";
import Verticals from "@/pages/Verticals";
import LegalPage from "@/pages/LegalPage";
import Events from "@/pages/Events";
import DigitalSolutions from "@/pages/DigitalSolutions";
import Academy from "@/pages/Academy";
import Ebooks from "@/pages/Ebooks";
import { CartProvider } from "@/context/CartContext";
import { AuthProvider } from "@/context/AuthContext";

/*
 * Admin + warehouse screens load on demand. They were in the main bundle, so
 * every shopper downloaded the whole admin (marketing, warehouse, orders…) just
 * to browse books. Safe for hydration: none of these routes is prerendered —
 * /admin and /warehouse always mount fresh from the app shell.
 */
const AdminLayout = lazy(() => import("@/pages/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard"));
const AdminBooks = lazy(() => import("@/pages/admin/AdminBooks"));
const AdminHampers = lazy(() => import("@/pages/admin/AdminHampers"));
const AdminPacks = lazy(() => import("@/pages/admin/AdminPacks"));
const AdminOrders = lazy(() => import("@/pages/admin/AdminOrders"));
const AdminUsers = lazy(() => import("@/pages/admin/AdminUsers"));
const AdminWaitlists = lazy(() => import("@/pages/admin/AdminWaitlists"));
const AdminCoupons = lazy(() => import("@/pages/admin/AdminCoupons"));
const AdminInventory = lazy(() => import("@/pages/admin/AdminInventory"));
const AdminWarehouse = lazy(() => import("@/pages/admin/AdminWarehouse"));
const AdminWhatsApp = lazy(() => import("@/pages/admin/AdminWhatsApp"));
const AdminMarketing = lazy(() => import("@/pages/admin/AdminMarketing"));
const WarehouseApp = lazy(() => import("@/pages/warehouse/WarehouseApp"));
const AdminSubmissions = lazy(() => import("@/pages/admin/AdminSubmissions"));
const AdminSpam = lazy(() => import("@/pages/admin/AdminSpam"));
const AdminAudit = lazy(() => import("@/pages/admin/AdminAudit"));
const AdminMedia = lazy(() => import("@/pages/admin/AdminMedia"));
const AdminPages = lazy(() => import("@/pages/admin/AdminPages"));
const AdminNavigation = lazy(() => import("@/pages/admin/AdminNavigation"));
const AdminSettings = lazy(() => import("@/pages/admin/AdminSettings"));
const AdminPLP = lazy(() => import("@/pages/admin/AdminPLP"));
const AdminPDP = lazy(() => import("@/pages/admin/AdminPDP"));
const AdminAuthors = lazy(() => import("@/pages/admin/AdminAuthors"));
const AdminCareers = lazy(() => import("@/pages/admin/AdminCareers"));
const AdminMediaGallery = lazy(() => import("@/pages/admin/AdminMediaGallery"));
const AdminLegal = lazy(() => import("@/pages/admin/AdminLegal"));
const AdminMessages = lazy(() => import("@/pages/admin/AdminMessages"));
const AdminEbooks = lazy(() => import("@/pages/admin/AdminEbooks"));

const AdminFallback = () => <div className="p-8 text-sm text-[#4B5563]" role="status">Loading…</div>;
// Each admin page gets its own Suspense boundary, so moving between admin pages
// shows a small "Loading…" in the content area instead of blanking the shell.
const lazyPage = (C) => <Suspense fallback={<AdminFallback />}><C /></Suspense>;

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
sendVisitBeacon(API);

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
                                <Route path="/unsubscribe" element={<Unsubscribe />} />
                                <Route path="/subscribe/confirm" element={<SubscribeConfirm />} />
                                <Route path="/authors" element={<Authors />} />
                                <Route path="/authors/:id" element={<Authors />} />
                                {/* The old site's author URL. Still ranking, and
                                    every visitor was meeting the 404 page.
                                    Redirects only for slugs that name a real
                                    author — the old domain was compromised, so a
                                    pattern redirect would forward an attacker's
                                    links into this site. See WriterRedirect. */}
                                <Route path="/writer/:id" element={<WriterRedirect />} />
                                <Route path="/submissions" element={<Submissions />} />
                                <Route path="/careers" element={<Careers />} />
                                <Route path="/media" element={<MediaGallery />} />
                                <Route path="/what-we-do" element={<Verticals />} />
                                <Route path="/events" element={<Events />} />
                                <Route path="/digital-solutions" element={<DigitalSolutions />} />
                                <Route path="/academy" element={<Academy />} />
                                <Route path="/ebooks" element={<Ebooks />} />
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
                            {/* The warehouse phone screen: outside the shop layout and the
                                admin shell — one person, one phone, big buttons. */}
                            <Route
                                path="/warehouse"
                                element={
                                    <ProtectedRoute requireAdmin>
                                        {lazyPage(WarehouseApp)}
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/admin"
                                element={
                                    <ProtectedRoute requireAdmin>
                                        {lazyPage(AdminLayout)}
                                    </ProtectedRoute>
                                }
                            >
                                <Route index element={lazyPage(AdminDashboard)} />
                                <Route path="books" element={lazyPage(AdminBooks)} />
                                <Route path="hampers" element={lazyPage(AdminHampers)} />
                                <Route path="packs" element={lazyPage(AdminPacks)} />
                                <Route path="orders" element={lazyPage(AdminOrders)} />
                                <Route path="users" element={lazyPage(AdminUsers)} />
                                <Route path="waitlists" element={lazyPage(AdminWaitlists)} />
                                <Route path="coupons" element={lazyPage(AdminCoupons)} />
                                <Route path="inventory" element={lazyPage(AdminInventory)} />
                                <Route path="warehouse" element={lazyPage(AdminWarehouse)} />
                                <Route path="whatsapp" element={lazyPage(AdminWhatsApp)} />
                                <Route path="marketing" element={lazyPage(AdminMarketing)} />
                                <Route path="submissions" element={lazyPage(AdminSubmissions)} />
                                <Route path="spam" element={lazyPage(AdminSpam)} />
                                <Route path="audit" element={lazyPage(AdminAudit)} />
                                <Route path="pages" element={lazyPage(AdminPages)} />
                                <Route path="navigation" element={lazyPage(AdminNavigation)} />
                                <Route path="media" element={lazyPage(AdminMedia)} />
                                <Route path="ebooks" element={lazyPage(AdminEbooks)} />
                                <Route path="page-bookstore" element={lazyPage(AdminPLP)} />
                                <Route path="page-book" element={lazyPage(AdminPDP)} />
                                <Route path="authors" element={lazyPage(AdminAuthors)} />
                                <Route path="careers" element={lazyPage(AdminCareers)} />
                                <Route path="media-gallery" element={lazyPage(AdminMediaGallery)} />
                                <Route path="messages" element={lazyPage(AdminMessages)} />
                                <Route path="legal" element={lazyPage(AdminLegal)} />
                                <Route path="settings" element={lazyPage(AdminSettings)} />
                            </Route>
                        </Routes>
                    </BrowserRouter>
                </CartProvider>
            </AuthProvider>
        </div>
    );
}

export default App;
