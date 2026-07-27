import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

// Attach Bearer token on every request if present.
api.interceptors.request.use((config) => {
    const token = localStorage.getItem("oakbridge_token");
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

/*
 * Tokens live 7 days, and they also stop working if JWT_SECRET is rotated on the
 * server. Without this handler an expired token produced a silent dead end:
 * Account, Orders and Admin all failed their fetches and rendered empty, with no
 * hint that the fix was simply to sign in again.
 *
 * On a 401 we drop the stale token and send the user to /login with a `next`
 * param so they land back where they were. Failures from the auth endpoints
 * themselves are passed through untouched — a wrong password is also a 401, and
 * that has to reach the login form as an error rather than trigger a redirect.
 */
api.interceptors.response.use(
    (r) => r,
    (error) => {
        const status = error?.response?.status;
        const url = error?.config?.url || "";
        const isAuthCall = url.startsWith("/auth/");
        if (status === 401 && !isAuthCall && typeof window !== "undefined") {
            localStorage.removeItem("oakbridge_token");
            const here = window.location.pathname + window.location.search;
            if (!window.location.pathname.startsWith("/login")) {
                window.location.assign(`/login?expired=1&next=${encodeURIComponent(here)}`);
            }
        }
        return Promise.reject(error);
    },
);

// Public
export const fetchCategories = () => api.get("/categories").then((r) => r.data);
export const fetchBooks = (params = {}) =>
    api.get("/books", { params }).then((r) => r.data);
export const fetchFeatured = () =>
    api.get("/books/featured").then((r) => r.data);
export const fetchNewReleases = (limit = 12) =>
    api.get("/books/new-releases", { params: { limit } }).then((r) => r.data);
export const fetchBestsellers = (limit = 12) =>
    api.get("/books/bestsellers", { params: { limit } }).then((r) => r.data);
export const fetchBook = (id) => api.get(`/books/${id}`).then((r) => r.data);
export const notifyBackInStock = (bookId, email) =>
    api.post(`/books/${bookId}/notify-me`, { email }).then((r) => r.data);
export const subscribeNewsletter = (email, source) =>
    api.post("/newsletter", { email, ...(source ? { source } : {}) }).then((r) => r.data);

// ====== Razorpay ======
export const createPaymentOrder = (orderId) =>
    api.post("/payments/create-order", { order_id: orderId }).then((r) => r.data);
export const verifyPayment = (payload) =>
    api.post("/payments/verify", payload).then((r) => r.data);
export const submitContact = (payload) =>
    api.post("/contact", payload).then((r) => r.data);
export const createOrder = (payload) =>
    api.post("/orders", payload).then((r) => r.data);
export const fetchOrder = (id) => api.get(`/orders/${id}`).then((r) => r.data);

// Authors
export const fetchAuthors = () => api.get("/authors").then((r) => r.data);
export const fetchAuthor = (id) => api.get(`/authors/${id}`).then((r) => r.data);
export const fetchAuthorBooks = (id) =>
    api.get(`/authors/${id}/books`).then((r) => r.data);

// Desk copies
export const requestDeskCopy = (payload) =>
    api.post("/desk-copies", payload).then((r) => r.data);

// Reviews
export const fetchReviews = (bookId) =>
    api.get(`/books/${bookId}/reviews`).then((r) => r.data);
export const createReview = (bookId, payload) =>
    api.post(`/books/${bookId}/reviews`, payload).then((r) => r.data);

// Auth
export const authLogin = (email, password) =>
    api.post("/auth/login", { email, password }).then((r) => r.data);
export const authRegister = (payload) =>
    api.post("/auth/register", payload).then((r) => r.data);
export const authMe = () => api.get("/auth/me").then((r) => r.data);
export const verifyOtp = (code) =>
    api.post("/auth/verify-otp", { code }).then((r) => r.data);
export const resendOtp = () =>
    api.post("/auth/resend-otp").then((r) => r.data);
export const forgotPassword = (email) =>
    api.post("/auth/forgot-password", { email }).then((r) => r.data);
export const resetPassword = (token, password) =>
    api.post("/auth/reset-password", { token, password }).then((r) => r.data);
export const syncInventoryFromSheet = () =>
    api.post("/admin/inventory/sync-from-sheet").then((r) => r.data);

// My account
export const fetchMyOrders = () => api.get("/my/orders").then((r) => r.data);
export const saveCart = (items) =>
    api.put("/my/cart", { items }).then((r) => r.data);
export const loadCart = () => api.get("/my/cart").then((r) => r.data);
export const adminRunCartReminders = () =>
    api.post("/admin/cart-reminders/run?force=true").then((r) => r.data);

// ====== Media library + site imagery ======
export const fetchSiteContent = () => api.get("/site-content").then((r) => r.data);
export const adminSetSiteContent = (key, value) =>
    api.put("/admin/site-content", { key, value }).then((r) => r.data);
export const adminListMedia = () => api.get("/admin/media").then((r) => r.data);
export const adminUploadMedia = (file, alt = "") => {
    const form = new FormData();
    form.append("file", file);
    if (alt) form.append("alt", alt);
    return api
        .post("/admin/media", form, { headers: { "Content-Type": "multipart/form-data" } })
        .then((r) => r.data);
};
export const adminDeleteMedia = (id) =>
    api.delete(`/admin/media/${id}`).then((r) => r.data);
export const adminUpdateCategoryImage = (id, image) =>
    api.patch(`/admin/categories/${id}`, { image }).then((r) => r.data);
export const mediaUrl = (u) => (u && u.startsWith("/api/") ? `${BACKEND_URL}${u}` : u);
export const fetchSuggestIndex = () => api.get("/search/suggest-index").then((r) => r.data);
export const logSearch = (q, results, category) =>
    api.post("/search/log", { q, results, category: category || null }).catch(() => {});
export const adminSearchLogs = (days = 30) =>
    api.get(`/admin/search-logs?days=${days}`).then((r) => r.data);
export const fetchBookPreview = (id) => api.get(`/books/${id}/preview`).then((r) => r.data);
export const adminUploadBookPreview = (id, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post(`/admin/books/${id}/preview`, fd).then((r) => r.data);
};
export const adminRemoveBookPreview = (id) => api.delete(`/admin/books/${id}/preview`).then((r) => r.data);
export const fetchCollection = (key) => api.get(`/collections/${key}`).then((r) => r.data);
// Resolve a collection fetch to the list to render. Once an admin has saved the
// collection ("configured"), its items win even when empty — so a section the
// admin intentionally cleared stays cleared. Only an untouched collection falls
// back to the code defaults. Pass the raw fetchCollection result (or null while
// loading) as `d`.
export const resolveCollection = (d, defaults = []) =>
    d && d.configured ? (Array.isArray(d.items) ? d.items : []) : (d && Array.isArray(d.items) && d.items.length ? d.items : defaults);
export const adminSaveCollection = (key, items) =>
    api.put(`/admin/collections/${key}`, { items }).then((r) => r.data);
export const fetchSettings = () => api.get("/settings").then((r) => r.data);
export const adminSetSetting = (key, value) =>
    api.put("/admin/settings", { key, value }).then((r) => r.data);

// FAQ / website assistant chatbot
export const sendChat = (message, history = []) =>
    api.post("/chat", { message, history }).then((r) => r.data);

// Contact / enquiry messages (admin)
export const adminListMessages = () => api.get("/admin/messages").then((r) => r.data);
export const adminDeleteMessage = (id) =>
    api.delete(`/admin/messages/${id}`).then((r) => r.data);

// Legal / policy pages
export const fetchLegal = () => api.get("/legal").then((r) => r.data);
export const fetchLegalPage = (slug) => api.get(`/legal/${slug}`).then((r) => r.data);
export const adminSaveLegal = (slug, content) =>
    api.put(`/admin/legal/${slug}`, { content }).then((r) => r.data);

// Admin
export const adminStats = () => api.get("/admin/stats").then((r) => r.data);
export const adminListOrders = () =>
    api.get("/admin/orders").then((r) => r.data);
export const adminUpdateOrder = (id, status) =>
    api.patch(`/admin/orders/${id}`, { status }).then((r) => r.data);
export const adminResendReceipt = (id) =>
    api.post(`/admin/orders/${id}/resend-receipt`).then((r) => r.data);
export const adminDownloadInvoice = async (id, orderNumber) => {
    const res = await api.get(`/admin/orders/${id}/invoice.pdf`, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Invoice-${orderNumber || id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
};
export const adminListWaitlists = (source) => {
    const q = source ? `?source=${encodeURIComponent(source)}` : "";
    return api.get(`/admin/waitlists${q}`).then((r) => r.data);
};
export const adminDraftAuthorBio = (bookId) =>
    api.post(`/admin/books/${bookId}/draft-author-bio`).then((r) => r.data);
export const adminBulkDraftAuthorBios = (overwrite = false) =>
    api
        .post(`/admin/books/bulk-draft-author-bios?overwrite=${overwrite}`, null, { timeout: 0 })
        .then((r) => r.data);
export const adminListDeskCopies = () =>
    api.get("/admin/desk-copies").then((r) => r.data);
export const adminUpdateDeskCopy = (id, status) =>
    api.patch(`/admin/desk-copies/${id}`, { status }).then((r) => r.data);
export const adminCreateBook = (payload) =>
    api.post("/admin/books", payload).then((r) => r.data);
export const adminUpdateBook = (id, payload) =>
    api.patch(`/admin/books/${id}`, payload).then((r) => r.data);
export const adminDeleteBook = (id) =>
    api.delete(`/admin/books/${id}`).then((r) => r.data);
export const adminListUsers = () =>
    api.get("/admin/users").then((r) => r.data);
export const adminCreateUser = (payload) =>
    api.post("/admin/users", payload).then((r) => r.data);
export const adminSetUserRole = (id, role) =>
    api.patch(`/admin/users/${id}/role`, { role }).then((r) => r.data);
export const adminSetUserSections = (id, sections) =>
    api.patch(`/admin/users/${id}/sections`, { sections }).then((r) => r.data);
export const adminFetchRoles = () =>
    api.get("/admin/roles").then((r) => r.data);

// Coupons
export const validateCoupon = (code, subtotal) =>
    api.post("/coupons/validate", { code, subtotal }).then((r) => r.data);
export const adminListCoupons = () =>
    api.get("/admin/coupons").then((r) => r.data);
export const adminCreateCoupon = (payload) =>
    api.post("/admin/coupons", payload).then((r) => r.data);
export const adminUpdateCoupon = (id, payload) =>
    api.patch(`/admin/coupons/${id}`, payload).then((r) => r.data);
export const adminDeleteCoupon = (id) =>
    api.delete(`/admin/coupons/${id}`).then((r) => r.data);

export const adminUploadCover = (file) => {
    const form = new FormData();
    form.append("file", file);
    return api
        .post(`/admin/uploads/cover`, form, {
            headers: { "Content-Type": "multipart/form-data" },
        })
        .then((r) => r.data);
};

// ---- Careers ----
export const fetchJobs = () => api.get("/collections/careers_jobs").then((r) => r.data);
export const applyForJob = ({ name, phone, email, role, cv }) => {
    const form = new FormData();
    form.append("name", name);
    form.append("phone", phone);
    form.append("email", email);
    form.append("role", role || "");
    form.append("cv", cv);
    return api
        .post("/careers/apply", form, { headers: { "Content-Type": "multipart/form-data" } })
        .then((r) => r.data);
};
export const adminListJobApplications = () =>
    api.get("/admin/job-applications").then((r) => r.data);

// ---- Authors admin ----
export const adminListAuthors = () => api.get("/admin/authors").then((r) => r.data);
export const adminCreateAuthor = (payload) => api.post("/admin/authors", payload).then((r) => r.data);
export const adminUpdateAuthor = (id, payload) =>
    api.patch(`/admin/authors/${id}`, payload).then((r) => r.data);
export const adminDeleteAuthor = (id) => api.delete(`/admin/authors/${id}`).then((r) => r.data);
export const adminReorderAuthors = (ids) =>
    api.put("/admin/authors-order", { ids }).then((r) => r.data);
export const adminSetAuthorOrderMode = (mode) =>
    api.put(`/admin/authors-order-mode?mode=${mode}`).then((r) => r.data);
export const adminUploadAuthorPhoto = (file) => {
    const form = new FormData();
    form.append("file", file);
    return api
        .post(`/admin/uploads/author-photo`, form, {
            headers: { "Content-Type": "multipart/form-data" },
        })
        .then((r) => r.data);
};
export const adminBulkImportBooks = (file) => {
    const form = new FormData();
    form.append("file", file);
    return api
        .post(`/admin/books/bulk-import`, form, {
            headers: { "Content-Type": "multipart/form-data" },
        })
        .then((r) => r.data);
};
export const adminBulkDeleteBooks = (ids) =>
    api.post(`/admin/books/bulk-delete`, { ids }).then((r) => r.data);
export const adminDeleteAllBooks = (confirm) =>
    api
        .post(`/admin/books/bulk-delete`, { delete_all: true, confirm })
        .then((r) => r.data);

// eBook
export const adminUploadEbook = (bookId, file) => {
    const form = new FormData();
    form.append("file", file);
    return api
        .post(`/admin/books/${bookId}/ebook`, form, {
            headers: { "Content-Type": "multipart/form-data" },
        })
        .then((r) => r.data);
};
export const adminRemoveEbook = (bookId) =>
    api.delete(`/admin/books/${bookId}/ebook`).then((r) => r.data);
export const myBookEbookUrl = (bookId) => `${API}/my/books/${bookId}/ebook`;

// Inventory
export const adminLowStock = (threshold = 10) =>
    api.get("/admin/inventory/low-stock", { params: { threshold } }).then((r) => r.data);
export const adminInventory = (threshold = 10) =>
    api.get("/admin/inventory", { params: { threshold } }).then((r) => r.data);

// Submissions
export const submitManuscript = (payload) =>
    api.post("/submissions", payload).then((r) => r.data);
export const adminListSubmissions = () =>
    api.get("/admin/submissions").then((r) => r.data);
export const adminUpdateSubmission = (id, status) =>
    api.patch(`/admin/submissions/${id}`, { status }).then((r) => r.data);

export const formatINR = (n) =>
    new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(n);

/**
 * The shipping promise, derived from live settings rather than written out by
 * hand. A threshold of 0 means everything ships free — previously the PDP and
 * cart still advertised a ₹1,500 minimum that no longer existed, and the PDP
 * tile rendered the nonsense "On ₹0+".
 *
 * `short` is for the compact PDP tile; the long form is a full sentence.
 */
export const shippingPromise = (settings, { short = false } = {}) => {
    const thr = Number(settings?.free_ship_threshold ?? 0);
    if (!Number.isFinite(thr) || thr <= 0) {
        return short ? "On all orders" : "Free shipping on all orders.";
    }
    return short
        ? `On ${formatINR(thr)}+`
        : `Free shipping on orders over ${formatINR(thr)}.`;
};

export const formatApiError = (err) => {
    const d = err?.response?.data?.detail;
    if (!d) return err?.message || "Something went wrong.";
    if (typeof d === "string") return d;
    if (Array.isArray(d))
        return d
            .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
            .filter(Boolean)
            .join(" ");
    if (d && typeof d.msg === "string") return d.msg;
    return String(d);
};
