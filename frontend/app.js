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
  if (screen === "analytics") loadAnalytics();
  if (screen === "settings")  loadSettings();
  if (screen === "accounts")  loadAccounts();
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

  // Load nav badge for accounts warnings
  updateAccountsBadge();
});;

// ─── Dashboard ───────────────────────────────

async function loadDashboard() {
  try {
    // Check if sync is currently running
    fetch(`${API}/api/sync/status`).then(r => r.json()).then(st => {
      if (st && st.is_syncing && !syncPollInterval) {
        startProgressPolling();
      }
    }).catch(() => {});

    const [stats, ordersRes] = await Promise.all([
      fetch(`${API}/api/stats`).then(r => r.json()),
      fetch(`${API}/api/orders?limit=5`).then(r => r.json()),
    ]);

    // Stats cards
    document.getElementById("stat-total").textContent = stats.total_orders;
    document.getElementById("stat-cost").textContent = formatPrice(stats.total_cost);
    document.getElementById("stat-profit").textContent = formatPrice(stats.total_profit);
    document.getElementById("stat-delivered").textContent = stats.by_status?.delivered || 0;

    // Render Spending Trend Bar Chart
    renderSpendingChart(stats.recent_days || []);

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
    ? `<img src="${o.product_image}" class="ocard__img" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'ocard__img ocard__img--ph\\'>📦</div>'">`
    : `<div class="ocard__img ocard__img--ph">📦</div>`;

  const name = o.product_name
    ? (o.product_name.length > 55 ? o.product_name.slice(0, 55) + "…" : o.product_name)
    : "منتج بدون اسم";

  const orderId = o.amazon_order_id
    ? `<div class="ocard__id_full" style="font-family: monospace; font-size: 0.85rem; font-weight: bold; color: var(--text-primary); margin-bottom: 8px;">🆔 ${o.amazon_order_id}</div>`
    : `<div class="ocard__id_full" style="font-family: monospace; font-size: 0.85rem; font-weight: bold; color: var(--text-primary); margin-bottom: 8px;">🆔 غير معروف</div>`;

  const email = o.to_email
    ? `<span style="font-size: 0.75rem; color: var(--text-muted);">✉️ ${o.to_email}</span>`
    : "";

  const date = o.order_date ? formatDate(o.order_date) : "";

  const price = o.purchase_price != null
    ? `<span class="ocard__price">${formatPrice(o.purchase_price)}</span>`
    : "";

  const profit = (o.profit !== null && o.profit !== undefined && o.sale_price)
    ? `<span class="ocard__profit ${o.profit >= 0 ? 'pos' : 'neg'}">${o.profit >= 0 ? '+' : ''}${formatPrice(o.profit)}</span>`
    : "";

  const tracking = o.tracking_number
    ? `<span class="ocard__track" style="background: rgba(79, 195, 247, 0.1); padding: 2px 6px; border-radius: 6px; border: 1px solid rgba(79, 195, 247, 0.3);">🚚 ${o.tracking_number}</span>`
    : "";

  return `
    <div class="ocard ocard--${o.status}" onclick="openDetail(${o.id})">
      <span class="ocard__del" onclick="quickDeleteOrder(event,${o.id})" title="حذف">✕</span>
      ${img}
      <div class="ocard__body" style="flex: 1;">
        ${orderId}
        <div class="ocard__name" style="margin-bottom: 6px;">${name}</div>
        <div class="ocard__row1" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span class="badge badge--${o.status}">${o.status_ar || o.status}</span>
          ${email}
          ${date ? `<span class="ocard__date">${date}</span>` : ""}
        </div>
        <div class="ocard__row2" style="display: flex; justify-content: space-between; align-items: center;">
          <div>${price}${profit}</div>
          ${tracking}
        </div>
      </div>
    </div>
  `;
}

async function cleanupOrders() {
  if (!confirm("هل أنت متأكد من تنظيف قاعدة البيانات من الطلبات المكررة والإبقاء على أحدث نسخة؟")) return;
  
  try {
    const res = await fetch(`${API}/api/orders/cleanup`, { method: "POST" });
    const data = await res.json();
    if (data.success) {
      alert(`تم مسح ${data.cleaned_count} بطاقة مكررة بنجاح!`);
      loadOrders(); // reload
    } else {
      alert("حدث خطأ أثناء التنظيف.");
    }
  } catch (err) {
    alert("فشل الاتصال بالخادم.");
  }
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

  const emailSourceCard = (o.raw_subject || o.email_snippet || o.to_email) ? `
    <div class="info-card" style="padding:14px 16px;border-right:3px solid var(--purple)">
      <div style="font-size:0.85rem;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <span>📧 البريد المستوحى منه (مصدر الطلب)</span>
      </div>
      ${o.raw_subject ? `<div style="font-size:0.82rem;font-weight:600;color:var(--text-primary);margin-bottom:4px">📬 ${o.raw_subject}</div>` : ""}
      <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:6px">
        <span>إلى: <strong style="direction:ltr;display:inline-block;color:var(--accent-light)">${o.to_email || '—'}</strong></span>
        ${o.order_date ? ` • <span>${formatDate(o.order_date)}</span>` : ""}
      </div>
      ${o.email_snippet ? `<div style="font-size:0.75rem;background:rgba(255,255,255,0.04);padding:8px 10px;border-radius:6px;color:var(--text-muted);line-height:1.4">“${o.email_snippet}”</div>` : ""}
    </div>
  ` : "";

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

    ${emailSourceCard}

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

// ─── Sync & Progress ──────────────────────────

let syncPollInterval = null;

function startProgressPolling() {
  const banner = document.getElementById("sync-progress-banner");
  if (banner) banner.classList.remove("hidden");

  if (syncPollInterval) clearInterval(syncPollInterval);

  syncPollInterval = setInterval(async () => {
    try {
      const state = await fetch(`${API}/api/sync/status`).then(r => r.json());
      if (state && state.is_syncing) {
        if (banner) banner.classList.remove("hidden");
        const titleEl = document.getElementById("sync-banner-title");
        const percentEl = document.getElementById("sync-banner-percent");
        const fillEl = document.getElementById("sync-progress-fill");
        const subEl = document.getElementById("sync-banner-sub");

        if (titleEl) titleEl.textContent = state.mode === "ai" ? "🤖 جاري التحليل الذكي الشامل عبر Gemini AI..." : "🔄 جاري المزامنة السريعة...";
        if (percentEl) percentEl.textContent = `${state.percent}%`;
        if (fillEl) fillEl.style.width = `${state.percent}%`;
        if (subEl) {
          subEl.textContent = state.total_emails > 0
            ? `تم فحص ${state.processed_emails} من أصل ${state.total_emails} رسالة • ${state.current_subject || ''}`
            : `جاري التراسل والجلب من أمازون...`;
        }
      } else {
        // Sync finished
        if (syncPollInterval) {
          clearInterval(syncPollInterval);
          syncPollInterval = null;
        }
        if (banner) banner.classList.add("hidden");
        loadDashboard();
      }
    } catch(e) {
      console.error("Sync poll error:", e);
    }
  }, 1200);
}

async function triggerSync() {
  const icon = document.getElementById("sync-icon")?.closest(".icon-btn");
  if (icon) icon.classList.add("spinning");
  try {
    const res = await fetch(`${API}/api/sync`, { method: "POST" }).then(r => r.json());
    if (res.success === false) {
      showToast(`⚠️ ${res.message}`, "error");
    } else {
      showToast("🔄 بدأت المزامنة الفورية في الخلفية..");
    }
    startProgressPolling();
  } catch(e) {
    showToast("❌ خطأ في المزامنة");
  } finally {
    if (icon) icon.classList.remove("spinning");
  }
}

async function triggerAISync() {
  showToast("🤖 بدأت المزامنة الذكية الشاملة في الخلفية...");
  try {
    const res = await fetch(`${API}/api/sync/ai`, { method: "POST" }).then(r => r.json());
    if (res.success === false) {
      showToast(`⚠️ ${res.message}`, "error");
    } else {
      showToast("✨ جاري معالجة كافة الرسائل بواسطة Gemini AI..");
    }
    startProgressPolling();
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

function quickDeleteOrder(event, orderId) {
  event.stopPropagation();
  if (confirm("هل تريد حذف هذا الطلب فوراً؟")) {
    deleteOrder(orderId);
  }
}

// ─── Analytics ────────────────────────────────

let currentAnalyticsPeriod = "all";

function setAnalyticsPeriod(btn, period) {
  document.querySelectorAll("#screen-analytics .filter-pill").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  currentAnalyticsPeriod = period;
  loadAnalytics();
}

async function loadAnalytics() {
  const searchVal = document.getElementById("analytics-search")?.value?.trim() || "";
  try {
    const url = `${API}/api/analytics?period=${currentAnalyticsPeriod}&search=${encodeURIComponent(searchVal)}`;
    const data = await fetch(url).then(r => r.json());

    document.getElementById("analytics-total-items").textContent = data.total_items;
    document.getElementById("analytics-total-spent").textContent = formatPrice(data.total_spent);
    document.getElementById("analytics-unique-products").textContent = data.unique_products;
    document.getElementById("analytics-cancelled-items").textContent = data.status_breakdown?.cancelled || 0;

    const container = document.getElementById("analytics-products-list");
    if (!container) return;

    if (!data.top_products || !data.top_products.length) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state__icon">📊</div>
        <div class="empty-state__title">لا توجد بيانات للفترة المحددة</div>
      </div>`;
      return;
    }

    container.innerHTML = data.top_products.map(p => {
      const img = p.product_image
        ? `<img src="${p.product_image}" class="order-card__img" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'order-card__img\\'>📦</div>'">`
        : `<div class="order-card__img">📦</div>`;

      return `
        <div class="order-card" style="cursor:default">
          ${img}
          <div class="order-card__info">
            <div class="order-card__name">${p.product_name}</div>
            <div class="order-card__meta">
              <span class="badge badge--shipped" style="background:var(--accent);color:#fff">تم الشراء ${p.count} مرات</span>
            </div>
          </div>
          <div class="order-card__right">
            <span class="order-card__price">${formatPrice(p.total_cost)}</span>
            <span style="font-size:0.7rem;color:var(--text-muted);margin-top:2px">المتوسط: ${formatPrice(p.total_cost / p.count)}</span>
          </div>
        </div>
      `;
    }).join("");

  } catch(e) {
    console.error("Analytics load error:", e);
  }
}

function exportCSV() {
  showToast("📥 جاري تصدير الملف كـ Excel / CSV...");
  window.location.href = `${API}/api/orders/export`;
}

function copyToClipboard(text, label = "رقم الطلب") {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast(`📋 تم نسخ ${label} بنجاح!`);
  }).catch(() => {
    showToast("❌ تعذر النسخ");
  });
}

function renderSpendingChart(recentDays) {
  const container = document.getElementById("spending-trend-bars");
  if (!container) return;

  if (!recentDays || !recentDays.length) {
    container.innerHTML = `<div style="font-size:0.75rem;color:var(--text-muted);width:100%;text-align:center">لا توجد بيانات نشاط مؤخراً</div>`;
    return;
  }

  const maxCount = Math.max(...recentDays.map(r => r.count || 1));
  const sorted = [...recentDays].reverse(); // oldest to newest

  container.innerHTML = sorted.map(r => {
    const heightPercent = Math.max(10, Math.round((r.count / maxCount) * 100));
    const dayLabel = (r.day || "").split("-").slice(1).join("/");
    return `
      <div class="chart-bar-item" title="${r.day}: ${r.count} طلبات">
        <div class="chart-bar-fill" style="height:${heightPercent}%"></div>
        <span class="chart-bar-label">${dayLabel}</span>
      </div>
    `;
  }).join("");
}

/* ─── Smart Assistant Logic ──────────────────────────── */
async function sendChatMessage() {
  const inputEl = document.getElementById("chat-input");
  const messagesContainer = document.getElementById("chat-messages");
  const text = inputEl.value.trim();
  
  if (!text) return;
  
  // Add user message
  const userMsg = document.createElement("div");
  userMsg.className = "chat-message user";
  userMsg.textContent = text;
  messagesContainer.appendChild(userMsg);
  
  inputEl.value = "";
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  
  // Add loading indicator
  const loadMsg = document.createElement("div");
  loadMsg.className = "chat-message assistant";
  loadMsg.textContent = "جاري التفكير...";
  loadMsg.style.opacity = "0.7";
  messagesContainer.appendChild(loadMsg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  
  try {
    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    }).then(r => r.json());
    
    loadMsg.remove();
    
    if (res.reply) {
      const astMsg = document.createElement("div");
      astMsg.className = "chat-message assistant";
      // Basic markdown to html replacement (bold and new lines)
      let formattedReply = res.reply.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      formattedReply = formattedReply.replace(/\n/g, '<br>');
      astMsg.innerHTML = formattedReply;
      messagesContainer.appendChild(astMsg);
    } else {
      throw new Error("No reply");
    }
  } catch (e) {
    console.error(e);
    loadMsg.textContent = "❌ حدث خطأ في الاتصال بالمساعد الذكي.";
    loadMsg.style.color = "var(--red)";
  }
  
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Allow Enter key to send message
document.getElementById("chat-input")?.addEventListener("keypress", function(e) {
  if (e.key === "Enter") {
    sendChatMessage();
  }
});

// ─── Accounts Health ────────────────────────────────

let allAccountsData = [];
let currentAccountFilter = "all";

const healthLabels = {
  healthy:  { icon: "✅", text: "سليمة",   cls: "healthy" },
  warning:  { icon: "⚠️", text: "تحذير",  cls: "warning" },
  error:    { icon: "❌", text: "خطأ",    cls: "error" },
  revoked:  { icon: "🔴", text: "منتهي Token", cls: "revoked" },
  inactive: { icon: "⏸️", text: "معطل",   cls: "inactive" },
  unknown:  { icon: "❓", text: "غير معروف", cls: "unknown" },
};

async function loadAccounts() {
  const container = document.getElementById("accounts-health-list");
  if (!container) return;
  container.innerHTML = `<div class="empty-state"><div class="empty-state__icon">⏳</div><div class="empty-state__title">جاري تحميل...</div></div>`;

  try {
    const data = await fetch(`${API}/api/accounts/health`).then(r => r.json());
    allAccountsData = data;
    renderAccountsList();
    updateAccountsSummary();
    updateAccountsBadge();
  } catch(e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state__icon">❌</div><div class="empty-state__title">خطأ في تحميل البيانات</div></div>`;
    console.error(e);
  }
}

function renderAccountsList() {
  const container = document.getElementById("accounts-health-list");
  if (!container) return;

  const filtered = currentAccountFilter === "all"
    ? allAccountsData
    : allAccountsData.filter(a => a.health_status === currentAccountFilter);

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon">👥</div>
      <div class="empty-state__title">لا توجد حسابات بهذا التصنيف</div>
    </div>`;
    return;
  }

  container.innerHTML = filtered.map(a => renderAccountCard(a)).join("");
}

function renderAccountCard(a) {
  const h = healthLabels[a.health_status] || healthLabels.unknown;
  const initials = (a.email || "?")[0].toUpperCase();

  const lastSync = a.last_synced
    ? `• مزامنة: ${formatDate(a.last_synced)}`
    : `• لم تتم مزامنة`;

  const lastOrder = a.days_since_order !== null && a.days_since_order !== undefined
    ? `• آخر طلب: منذ ${a.days_since_order} يوم`
    : `• لا توجد طلبات`;

  const failBadge = a.consecutive_failures > 0
    ? `<span style="color:var(--red);font-size:0.68rem;">• فشل ${a.consecutive_failures}× متتالي</span>`
    : "";

  const errorBlock = a.last_error
    ? `<div class="acc-card__error">⚠️ ${a.last_error}</div>` : "";

  const tokenWarning = !a.has_token
    ? `<div class="acc-card__error">🔐 لا يوجد تفويض OAuth — أعد ربط الحساب</div>` : "";

  const reconnectBtn = (a.health_status === "revoked" || !a.has_token)
    ? `<button class="acc-action-btn acc-action-btn--primary" onclick="reconnectAccount('${a.email}')">🔗 إعادة ربط</button>` : "";

  return `
    <div class="acc-card acc-card--${h.cls}">
      <div class="acc-card__header">
        <div class="acc-card__avatar">${initials}</div>
        <div class="acc-card__info">
          <div class="acc-card__email" title="${a.email}">${a.email}</div>
          <span class="acc-card__status-badge badge--${h.cls}">${h.icon} ${h.text}</span>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);text-align:center;">
          <div style="font-weight:700;font-size:1rem;color:var(--text-primary);">${a.order_count}</div>
          <div>طلبات</div>
        </div>
      </div>

      <div class="acc-card__meta">
        <span>${lastSync}</span>
        <span>${lastOrder}</span>
        ${failBadge}
      </div>

      ${errorBlock}${tokenWarning}

      <div class="acc-card__actions">
        <button class="acc-action-btn" onclick="healthCheckAccount(${a.id}, this)">🔍 فحص</button>
        <button class="acc-action-btn" onclick="syncOneAccount(${a.id}, this)">🔄 مزامنة</button>
        ${reconnectBtn}
        <button class="acc-action-btn acc-action-btn--danger" onclick="deleteAccountFromHealth(${a.id})">🗑️ حذف</button>
      </div>
    </div>
  `;
}

function updateAccountsSummary() {
  const counts = { healthy: 0, warning: 0, error: 0, revoked: 0, inactive: 0, unknown: 0 };
  allAccountsData.forEach(a => {
    counts[a.health_status] = (counts[a.health_status] || 0) + 1;
  });
  const el = id => document.getElementById(id);
  if (el("acc-count-healthy"))  el("acc-count-healthy").textContent  = counts.healthy;
  if (el("acc-count-warning"))  el("acc-count-warning").textContent  = counts.warning + counts.unknown;
  if (el("acc-count-error"))    el("acc-count-error").textContent    = counts.error;
  if (el("acc-count-revoked"))  el("acc-count-revoked").textContent  = counts.revoked + counts.inactive;
}

async function updateAccountsBadge() {
  try {
    const data = await fetch(`${API}/api/accounts/health`).then(r => r.json());
    const bad = data.filter(a => ["error","revoked","warning"].includes(a.health_status)).length;
    const badge = document.getElementById("accounts-nav-badge");
    if (badge) {
      if (bad > 0) {
        badge.textContent = bad;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }
  } catch(e) {}
}

function filterAccounts(filter, btn) {
  currentAccountFilter = filter;
  document.querySelectorAll("#accounts-filter-bar .filter-pill").forEach(p => p.classList.remove("active"));
  if (btn) btn.classList.add("active");
  renderAccountsList();
}

async function healthCheckAccount(accountId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = "⏳..."; }
  try {
    const res = await fetch(`${API}/api/accounts/${accountId}/health-check`, { method: "POST" }).then(r => r.json());
    const h = healthLabels[res.health_status] || healthLabels.unknown;
    showToast(`${h.icon} نتيجة الفحص: ${h.text}`);
    await loadAccounts();
  } catch(e) {
    showToast("❌ خطأ في الفحص", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🔍 فحص"; }
  }
}

async function syncOneAccount(accountId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = "⏳..."; }
  try {
    const res = await fetch(`${API}/api/accounts/${accountId}/sync`, { method: "POST" }).then(r => r.json());
    showToast(res.success !== false ? "✅ تمت المزامنة بنجاح" : `⚠️ ${res.message}`);
    await loadAccounts();
  } catch(e) {
    showToast("❌ خطأ في المزامنة", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🔄 مزامنة"; }
  }
}

function reconnectAccount(email) {
  showToast("🔗 جاري فتح نافذة المصادقة...");
  setTimeout(() => { window.location.href = `${API}/auth/gmail`; }, 800);
}

async function deleteAccountFromHealth(accountId) {
  if (!confirm("هل تريد حذف هذا الحساب وكل طلباته نهائياً؟")) return;
  try {
    await fetch(`${API}/api/accounts/${accountId}`, { method: "DELETE" });
    showToast("✅ تم حذف الحساب");
    await loadAccounts();
    updateAccountsBadge();
  } catch(e) {
    showToast("❌ خطأ في الحذف", "error");
  }
}
