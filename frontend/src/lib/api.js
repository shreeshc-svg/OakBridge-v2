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

// Public
export const fetchCategories = () => api.get("/categories").then((r) => r.data);
export const fetchBooks = (params = {}) =>
    api.get("/books", { params }).then((r) => r.data);
export const fetchFeatured = () =>
    api.get("/books/featured").then((r) => r.data);
export const fetchNewReleases = () =>
    api.get("/books/new-releases").then((r) => r.data);
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

// My account
export const fetchMyOrders = () => api.get("/my/orders").then((r) => r.data);
export const saveCart = (items) =>
    api.put("/my/cart", { items }).then((r) => r.data);
export const loadCart = () => api.get("/my/cart").then((r) => r.data);
export const adminRunCartReminders = () =>
    api.post("/admin/cart-reminders/run?force=true").then((r) => r.data);

// Admin
export const adminStats = () => api.get("/admin/stats").then((r) => r.data);
export const adminListOrders = () =>
    api.get("/admin/orders").then((r) => r.data);
export const adminUpdateOrder = (id, status) =>
    api.patch(`/admin/orders/${id}`, { status }).then((r) => r.data);
export const adminResendReceipt = (id) =>
    api.post(`/admin/orders/${id}/resend-receipt`).then((r) => r.data);
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
