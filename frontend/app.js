/* ══════════════════════════════════════════════
   Amazon Order Tracker — App Logic (SPA)
══════════════════════════════════════════════ */

const API = "";  // same origin
let allOrders = [];
let activeStatusFilter = "";
let currentDetailId = null;
let previousScreen = "dashboard";

// ─── Navigation ─────────────────────────────

function navigate(screen) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

  const el = document.getElementById(`screen-${screen}`);
  if (el) el.classList.add("active");

  const navEl = document.querySelector(`.nav-item[data-screen="${screen}"]`);
  if (navEl) navEl.classList.add("active");

  if (screen === "dashboard") loadDashboard();
  if (screen === "orders")    loadOrders();
  if (screen === "settings")  loadSettings();
}

function goBack() {
  navigate(previousScreen || "orders");
}

// ─── Init ────────────────────────────────────

window.addEventListener("DOMContentLoaded", async () => {
  navigate("dashboard");

  // Check if came back from OAuth
  const params = new URLSearchParams(location.search);
  if (params.get("connected")) {
    showToast("✅ تم ربط Gmail بنجاح!");
    history.replaceState({}, "", "/");
  }
  if (params.get("error")) {
    showToast("❌ فشل ربط Gmail. حاول مجدداً.", "error");
    history.replaceState({}, "", "/");
  }
});

// ─── Dashboard ───────────────────────────────

async function loadDashboard() {
  try {
    const [stats, ordersRes] = await Promise.all([
      fetch(`${API}/api/stats`).then(r => r.json()),
      fetch(`${API}/api/orders?limit=5`).then(r => r.json()),
    ]);

    // Stats cards
    document.getElementById("stat-total").textContent = stats.total_orders;
    document.getElementById("stat-cost").textContent = formatPrice(stats.total_cost);
    document.getElementById("stat-profit").textContent = formatPrice(stats.total_profit);
    document.getElementById("stat-delivered").textContent = stats.by_status?.delivered || 0;

    // Status pills
    const pillsEl = document.getElementById("status-pills");
    const statusDef = [
      { k: "pending",   label: "⏳ انتظار"  },
      { k: "shipped",   label: "🚚 شحن"      },
      { k: "delivered", label: "✅ وصل"      },
      { k: "cancelled", label: "❌ ملغى"     },
      { k: "returned",  label: "↩️ مُعاد"    },
    ];
    pillsEl.innerHTML = statusDef.map(s => `
      <div class="status-pill">
        ${s.label} <span class="count">${stats.by_status?.[s.k] || 0}</span>
      </div>
    `).join("");

    // Email breakdown
    const emailEl = document.getElementById("email-breakdown");
    if (stats.by_email?.length) {
      emailEl.innerHTML = stats.by_email.map(e => `
        <div class="email-card">
          <div class="email-card__avatar">${getInitial(e.email)}</div>
          <div class="email-card__info">
            <div class="email-card__email">${e.email}</div>
            <div class="email-card__meta">إنفاق: ${formatPrice(e.spent)}</div>
          </div>
          <div class="email-card__badge">${e.count} طلب</div>
        </div>
      `).join("");
    } else {
      emailEl.innerHTML = `<div class="empty-state">
        <div class="empty-state__icon">📧</div>
        <div class="empty-state__title">لا يوجد حسابات مربوطة</div>
        <div class="empty-state__desc">اذهب للإعدادات لربط Gmail</div>
      </div>`;
    }

    // Recent orders
    const recentEl = document.getElementById("recent-orders");
    if (ordersRes.orders?.length) {
      recentEl.innerHTML = ordersRes.orders.map(o => renderOrderCard(o)).join("");
    } else {
      recentEl.innerHTML = `<div class="empty-state">
        <div class="empty-state__icon">📦</div>
        <div class="empty-state__title">لا توجد طلبات بعد</div>
        <div class="empty-state__desc">ارتبط بـ Gmail وستظهر طلباتك تلقائياً</div>
      </div>`;
    }

  } catch(e) {
    console.error("Dashboard load error:", e);
  }
}

// ─── Orders ──────────────────────────────────

let statusFilter = "";

async function loadOrders() {
  try {
    const url = statusFilter
      ? `${API}/api/orders?status=${statusFilter}&limit=200`
      : `${API}/api/orders?limit=200`;
    const res = await fetch(url).then(r => r.json());
    allOrders = res.orders || [];
    renderOrdersList();
  } catch(e) {
    console.error("Orders load error:", e);
  }
}

function renderOrdersList() {
  const search = document.getElementById("order-search")?.value?.toLowerCase() || "";
  const container = document.getElementById("orders-list-container");
  if (!container) return;

  let filtered = allOrders;
  if (search) {
    filtered = filtered.filter(o =>
      (o.product_name || "").toLowerCase().includes(search) ||
      (o.amazon_order_id || "").toLowerCase().includes(search) ||
      (o.to_email || "").toLowerCase().includes(search)
    );
  }

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon">🔍</div>
      <div class="empty-state__title">لا توجد نتائج</div>
    </div>`;
    return;
  }

  container.innerHTML = filtered.map(o => renderOrderCard(o)).join("");
}

function renderOrderCard(o) {
  const img = o.product_image
    ? `<img src="${o.product_image}" class="order-card__img" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'order-card__img\\'>📦</div>'">`
    : `<div class="order-card__img">📦</div>`;

  const profit = o.profit !== null && o.profit !== undefined
    ? `<span class="order-card__profit ${o.profit >= 0 ? 'positive' : 'negative'}">
        ${o.profit >= 0 ? '+' : ''}${formatPrice(o.profit)}
       </span>`
    : "";

  const date = o.order_date ? formatDate(o.order_date) : "";
  const notesHtml = o.notes ? `<div style="font-size:0.7rem;color:var(--accent-light);margin-top:3px;font-style:italic">🤖 ${o.notes}</div>` : "";

  return `
    <button class="order-card order-card--${o.status}" onclick="openDetail(${o.id})">
      ${img}
      <div class="order-card__info">
        <div class="order-card__name">${o.product_name || 'منتج بدون اسم'}</div>
        <div class="order-card__meta">
          <span class="badge badge--${o.status}">${o.status_ar || o.status}</span>
          <span class="order-card__email">${o.to_email || ''}</span>
        </div>
        ${notesHtml}
        ${date ? `<div style="font-size:0.68rem;color:var(--text-muted);margin-top:3px">${date}</div>` : ""}
      </div>
      <div class="order-card__right">
        <span class="order-card__price">${formatPrice(o.purchase_price)}</span>
        ${profit}
      </div>
    </button>
  `;
}

function filterOrders() {
  renderOrdersList();
}

function setStatusFilter(btn, status) {
  document.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  statusFilter = status;
  loadOrders();
}

// ─── Order Detail ─────────────────────────────

async function openDetail(orderId) {
  previousScreen = document.querySelector(".screen.active")?.id?.replace("screen-", "") || "orders";
  currentDetailId = orderId;

  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-detail").classList.add("active");

  try {
    const order = await fetch(`${API}/api/orders/${orderId}`).then(r => r.json());
    renderDetail(order);
  } catch(e) {
    console.error("Detail load error:", e);
  }
}

function renderDetail(o) {
  const img = o.product_image
    ? `<img src="${o.product_image}" class="detail-hero__img" style="width:80px;height:80px" alt="" onerror="this.outerHTML='<div class=\\'detail-hero__img\\'>📦</div>'">`
    : `<div class="detail-hero__img">📦</div>`;

  const profitCard = (o.profit !== null && o.profit !== undefined && o.sale_price)
    ? `<div class="profit-card ${o.profit < 0 ? 'loss' : ''}">
        <div class="profit-card__label">${o.profit >= 0 ? '💰 الربح الصافي' : '📉 الخسارة'}</div>
        <div class="profit-card__value">${o.profit >= 0 ? '+' : ''}${formatPrice(o.profit)}</div>
       </div>` : "";

  const history = (o.history || []).map(h => `
    <div class="timeline-item">
      <div class="timeline-dot ${h.source === 'tracking' ? 'tracking' : ''}"></div>
      <div class="timeline-text">
        <div class="timeline-status">${statusLabel(h.status)}</div>
        <div class="timeline-date">${formatDate(h.changed_at)} • ${
          h.source === 'email' ? '📧 إيميل' :
          h.source === 'tracking' ? '🚚 شركة الشحن' : '✏️ يدوي'
        }</div>
      </div>
    </div>
  `).join("");

  // بطاقة التتبع
  const carrierNames = {
    Amazon: "أمازون لوجستيك", SMSA: "SMSA سمسا",
    Aramex: "أرامكس", DHL: "DHL",
    FedEx: "فيدإكس", UPS: "UPS",
    SaudiPost: "البريد السعودي"
  };
  const carrierAr = carrierNames[o.carrier] || o.carrier || "—";

  const trackingCard = (o.tracking_number || o.tracking_url) ? `
    <div class="tracking-card" id="tracking-card-${o.id}">
      <div class="tracking-card__header">
        <span class="tracking-card__title">📦 تتبع الشحنة</span>
        <button class="btn-refresh-track" onclick="refreshTracking(${o.id})" title="تحديث">
          <svg id="track-spin-${o.id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>
      <div class="tracking-row">
        <span class="tracking-label">شركة الشحن</span>
        <span class="tracking-value">${carrierAr}</span>
      </div>
      ${o.tracking_number ? `<div class="tracking-row">
        <span class="tracking-label">رقم التتبع</span>
        <span class="tracking-value tracking-number" style="direction:ltr;font-family:monospace">${o.tracking_number}</span>
      </div>` : ""}
      ${o.estimated_delivery ? `<div class="tracking-row">
        <span class="tracking-label">🗓️ موعد التوصيل</span>
        <span class="tracking-value" style="color:var(--green);font-weight:700">${o.estimated_delivery}</span>
      </div>` : ""}
      <div id="tracking-events-${o.id}"></div>
      ${o.tracking_url ? `<a href="${o.tracking_url}" target="_blank" class="btn btn--primary btn--full" style="margin-top:10px;font-size:0.82rem">
        🔗 فتح صفحة التتبع
      </a>` : ""}
    </div>
  ` : `
    <div class="tracking-card empty">
      <div style="text-align:center;padding:10px">
        <div style="font-size:1.5rem;margin-bottom:6px">📭</div>
        <div style="font-size:0.8rem;color:var(--text-muted)">لم يُكتشف رقم تتبع بعد</div>
        ${o.amazon_order_id ? `<a href="https://www.amazon.sa/progress-tracker/package/?orderId=${o.amazon_order_id}" target="_blank" class="btn btn--secondary" style="margin-top:10px;width:100%;font-size:0.8rem">تتبع عبر أمازون</a>` : ""}
      </div>
    </div>
  `;

  document.getElementById("detail-content").innerHTML = `
    <div class="detail-hero">
      ${img}
      <div class="detail-hero__name">${o.product_name || 'منتج بدون اسم'}</div>
      <span class="detail-hero__id">${o.amazon_order_id || 'بدون رقم طلب'}</span>
      <div style="margin-top:10px">
        <span class="badge badge--${o.status}">${o.status_ar || o.status}</span>
      </div>
    </div>

    ${trackingCard}

    <div class="info-card">
      <div class="info-row">
        <span class="info-row__label">📧 الإيميل المستخدم</span>
        <span class="info-row__value" style="direction:ltr;font-size:0.78rem">${o.to_email || '—'}</span>
      </div>
      <div class="info-row">
        <span class="info-row__label">💰 سعر الشراء</span>
        <span class="info-row__value">${formatPrice(o.purchase_price)}</span>
      </div>
      <div class="info-row">
        <span class="info-row__label">🏷️ سعر البيع</span>
        <span class="info-row__value ${o.sale_price ? '' : 'red'}">${o.sale_price ? formatPrice(o.sale_price) : 'لم يُحدد'}</span>
      </div>
      <div class="info-row">
        <span class="info-row__label">📅 تاريخ الطلب</span>
        <span class="info-row__value">${o.order_date ? formatDate(o.order_date) : '—'}</span>
      </div>

      ${o.notes ? `<div class="info-row">
        <span class="info-row__label">📝 ملاحظات</span>
        <span class="info-row__value">${o.notes}</span>
      </div>` : ""}
    </div>

    ${profitCard}

    <div class="action-row">
      <button class="btn btn--primary" style="flex:1" onclick="openEditModal(${o.id})">✏️ تعديل</button>
      ${o.product_url ? `<a href="${o.product_url}" target="_blank" class="btn btn--secondary">🔗 أمازون</a>` : ""}
    </div>

    ${history ? `
      <div class="info-card" style="padding:14px 16px">
        <div style="font-size:0.85rem;font-weight:700;margin-bottom:12px">🕐 تاريخ التحديثات</div>
        <div class="timeline">${history}</div>
      </div>
    ` : ""}
  `;

  // Delete button
  document.getElementById("detail-delete-btn").onclick = () => deleteOrder(o.id);
}


// ─── Live Tracking ────────────────────────────

async function refreshTracking(orderId) {
  const spinEl = document.getElementById(`track-spin-${orderId}`);
  if (spinEl) spinEl.closest(".btn-refresh-track").classList.add("spinning");

  try {
    const result = await fetch(`${API}/api/orders/${orderId}/track`).then(r => r.json());
    const eventsEl = document.getElementById(`tracking-events-${orderId}`);

    if (eventsEl && result.events?.length) {
      eventsEl.innerHTML = `
        <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
          <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:8px;font-weight:600">📍 آخر الأحداث</div>
          ${result.events.slice(0, 5).map(e => `
            <div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
              <div style="width:8px;height:8px;border-radius:50%;background:var(--blue);margin-top:4px;flex-shrink:0"></div>
              <div>
                <div style="font-size:0.75rem;color:var(--text-primary)">${e.description || ''}</div>
                <div style="font-size:0.68rem;color:var(--text-muted)">${e.location || ''} ${e.date ? '· ' + formatDate(e.date) : ''}</div>
              </div>
            </div>
          `).join("")}
        </div>
      `;
    } else if (eventsEl) {
      eventsEl.innerHTML = `<div style="font-size:0.75rem;color:var(--text-muted);padding:8px 0;text-align:center">لا توجد أحداث متاحة حالياً</div>`;
    }

    if (result.estimated_delivery) {
      showToast(`🗓️ موعد التوصيل: ${result.estimated_delivery}`);
    } else {
      showToast("✅ تم تحديث معلومات التتبع");
    }

    // إعادة تحميل التفاصيل لو تغيرت الحالة
    if (result.status && result.status !== "pending") {
      openDetail(orderId);
    }
  } catch(e) {
    showToast("❌ خطأ في التتبع", "error");
  } finally {
    if (spinEl) spinEl.closest(".btn-refresh-track").classList.remove("spinning");
  }
}

// ─── Edit Modal ───────────────────────────────

async function openEditModal(orderId) {
  const order = await fetch(`${API}/api/orders/${orderId}`).then(r => r.json());

  document.getElementById("edit-order-id").value = orderId;
  document.getElementById("edit-product-name").value = order.product_name || "";
  document.getElementById("edit-sale-price").value = order.sale_price || "";
  document.getElementById("edit-status").value = order.status || "pending";
  document.getElementById("edit-notes").value = order.notes || "";

  document.getElementById("modal-edit").classList.remove("hidden");
}

function closeModal(name) {
  document.getElementById(`modal-${name}`).classList.add("hidden");
}

async function saveOrderEdit() {
  const id = document.getElementById("edit-order-id").value;
  const payload = {
    product_name: document.getElementById("edit-product-name").value || null,
    sale_price: parseFloat(document.getElementById("edit-sale-price").value) || null,
    status: document.getElementById("edit-status").value,
    notes: document.getElementById("edit-notes").value || null,
  };

  try {
    await fetch(`${API}/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    closeModal("edit");
    showToast("✅ تم الحفظ");
    openDetail(parseInt(id));
  } catch(e) {
    showToast("❌ خطأ في الحفظ", "error");
  }
}

async function deleteOrder(orderId) {
  if (!confirm("هل تريد حذف هذا الطلب نهائياً؟")) return;
  try {
    await fetch(`${API}/api/orders/${orderId}`, { method: "DELETE" });
    showToast("✅ تم الحذف");
    goBack();
  } catch(e) {
    showToast("❌ خطأ في الحذف");
  }
}

// ─── Settings ─────────────────────────────────

async function loadSettings() {
  try {
    const accounts = await fetch(`${API}/api/accounts`).then(r => r.json());
    const el = document.getElementById("accounts-list");

    if (!accounts.length) {
      el.innerHTML = `<div style="font-size:0.8rem;color:var(--text-muted);padding:8px 0">لا توجد حسابات مربوطة</div>`;
      return;
    }

    el.innerHTML = accounts.map(a => {
      const isError = a.status === "auth_error" || a.status === "revoked";
      const statusBadge = isError
        ? `<span class="badge-account-status error">⚠️ تحتاج إعادة ربط</span>`
        : `<span class="badge-account-status active">🟢 نشط</span>`;

      return `
        <div class="account-item ${isError ? 'has-error' : ''}">
          <div>
            <div class="account-item__email" style="direction:ltr;text-align:right">
              ${a.email} ${statusBadge}
            </div>
            <div class="account-item__meta">
              ${a.order_count} طلب
              ${a.last_synced ? ' • آخر فحص: ' + formatDate(a.last_synced) : ''}
              ${isError ? `<div style="color:var(--red);font-size:0.7rem;margin-top:2px">انتهت الجلسة أو ألغي التفويض</div>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            ${isError ? `<a href="${API}/auth/gmail" class="btn btn--primary" style="padding:4px 8px;font-size:0.72rem">إعادة ربط</a>` : ''}
            <button class="btn btn--secondary" style="padding:5px 10px;font-size:0.75rem" onclick="syncAccount(${a.id})" title="مزامنة فورية">🔄</button>
            <button class="btn-icon-danger" onclick="deleteAccount(${a.id})">حذف</button>
          </div>
        </div>
      `;
    }).join("");

  } catch(e) {
    console.error("Settings load error:", e);
  }
}

async function deleteAccount(id) {
  if (!confirm("هل تريد إلغاء ربط هذا الحساب وحذف طلباته؟")) return;
  try {
    await fetch(`${API}/api/accounts/${id}`, { method: "DELETE" });
    showToast("✅ تم الحذف");
    loadSettings();
  } catch(e) {
    showToast("❌ خطأ");
  }
}

async function syncAccount(id) {
  showToast("🔄 جاري المزامنة...");
  try {
    const res = await fetch(`${API}/api/accounts/${id}/sync`, { method: "POST" }).then(r => r.json());
    showToast(`✅ اكتملت المزامنة — ${res.new_orders} طلب جديد`);
    loadSettings();
  } catch(e) {
    showToast("❌ خطأ في المزامنة");
  }
}

function saveTelegramSettings() {
  // حفظ في localStorage فقط (إعداد خفيف)
  const chatId = document.getElementById("tg-chat-id").value;
  localStorage.setItem("tg_chat_id", chatId);
  showToast("✅ تم الحفظ");
}

// ─── Sync ─────────────────────────────────────

async function triggerSync() {
  const icon = document.getElementById("sync-icon")?.closest(".icon-btn");
  if (icon) icon.classList.add("spinning");
  try {
    const res = await fetch(`${API}/api/sync`, { method: "POST" }).then(r => r.json());
    showToast(`✅ تمت المزامنة — ${res.new_orders_found || 0} طلب جديد`);
    loadDashboard();
  } catch(e) {
    showToast("❌ خطأ في المزامنة");
  } finally {
    if (icon) icon.classList.remove("spinning");
  }
}

async function triggerAISync() {
  showToast("🤖 جاري تشغيل المزامنة الذكية الشاملة لكافة الرسائل والمعاملات...");
  try {
    const res = await fetch(`${API}/api/sync/ai`, { method: "POST" }).then(r => r.json());
    showToast(`✨ اكتملت مزامنة AI الشاملة — تم تحديث الطلبات والتفاصيل`);
    loadDashboard();
  } catch(e) {
    showToast("❌ خطأ في المزامنة الذكية");
  }
}

// ─── Helpers ──────────────────────────────────

function formatPrice(val) {
  if (val === null || val === undefined || val === "") return "—";
  return `${parseFloat(val).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("ar-SA", {
      year: "numeric", month: "short", day: "numeric"
    });
  } catch { return dateStr; }
}

function getInitial(email) {
  return (email || "?")[0].toUpperCase();
}

function statusLabel(status) {
  const map = {
    pending: "⏳ قيد الانتظار",
    shipped: "🚚 تم الشحن",
    delivered: "✅ تم التوصيل",
    returned: "↩️ مُعاد",
    cancelled: "❌ مُلغى",
  };
  return map[status] || status;
}

let toastTimer;
function showToast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}
