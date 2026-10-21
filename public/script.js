// ===== HELPERS =====
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

// Throws an Error carrying the server's message (and HTTP status) so callers can show something useful.
async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = new Error((data && data.message) || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function setYear() {
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function loadCartCount() {
  try {
    const data = await fetchJSON("/B_getcartcount");
    setText("cart-count", data.count ?? 0);
  } catch (err) {
    console.error("Failed to load cart count", err);
  }
}

async function updateAuthLink() {
  const link = document.getElementById("nav-auth-link");
  if (!link) return;

  try {
    const sessionData = await fetchJSON("/B_session");
    const user = sessionData && sessionData.user;
    if (user) {
      const first = String(user.name || "").trim().split(/\s+/)[0] || "Account";
      link.textContent = `👤 ${first} (Log out)`;
      link.href = "#";
      link.onclick = async (e) => {
        e.preventDefault();
        try {
          await fetchJSON("/B_logout", { method: "POST" });
        } finally {
          window.location.reload();
        }
      };
      return;
    }
  } catch (err) {
    console.warn("Could not load session", err);
  }

  link.textContent = "Login";
  link.href = "/login";
  link.onclick = null;
}

// ===== PRODUCTS PAGE =====
async function loadProductsPage() {
  const container = document.getElementById("products-container");
  if (!container) return;

  try {
    const data = await fetchJSON("/B_getproducts");
    container.innerHTML = data.products
      .map(
        (p) => `
        <div class="product-card">
          <img src="${escapeHTML(p.B_img)}" alt="${escapeHTML(p.B_name)}" class="product-image" />
          <h3 class="product-name">${escapeHTML(p.B_name)}</h3>
          <p class="product-desc">${escapeHTML(p.B_desc)}</p>
          <p class="product-price">$${Number(p.B_price).toFixed(2)}</p>
          <button class="add-to-cart-btn" data-id="${Number(p.id)}">Add to Cart</button>
        </div>`
      )
      .join("");

    container.addEventListener("click", async (e) => {
      const btn = e.target.closest(".add-to-cart-btn");
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      try {
        await fetchJSON("/B_addtocart", { method: "POST", body: JSON.stringify({ id: Number(btn.dataset.id), quantity: 1 }) });
        await loadCartCount();
        btn.textContent = "Added!";
      } catch (err) {
        alert(err.message || "Could not add to cart.");
      } finally {
        setTimeout(() => {
          btn.textContent = "Add to Cart";
          btn.disabled = false;
        }, 800);
      }
    });
  } catch (err) {
    container.innerHTML = "<p>Failed to load products.</p>";
  }
}

// ===== CART PAGE =====
function renderTotals(totals) {
  const t = totals || { subtotal: 0, tax: 0, total: 0 };
  setText("subtotal", Number(t.subtotal).toFixed(2));
  setText("tax", Number(t.tax).toFixed(2));
  setText("total", Number(t.total).toFixed(2));
}

function renderCartItems(data) {
  const items = data.items || [];
  const container = document.getElementById("cart-items");
  if (!container) return;

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  setText("item-count-text", `${totalItems} ${totalItems === 1 ? "item" : "items"}`);

  const checkoutBtn = document.getElementById("checkout-btn");
  if (checkoutBtn) checkoutBtn.disabled = items.length === 0;

  if (!items.length) {
    container.innerHTML = "<p style='text-align:center;color:#6b7280;padding:40px;'>Your cart is empty.</p>";
    renderTotals(null);
    return;
  }

  container.innerHTML = items
    .map(({ product, quantity }) => `
      <div class="cart-item">
        <img src="${escapeHTML(product.B_img)}" alt="${escapeHTML(product.B_name)}" class="cart-item-image" />
        <div class="cart-item-info">
          <h3>${escapeHTML(product.B_name)}</h3>
          <p>$${product.B_price.toFixed(2)}</p>
        </div>
        <div class="cart-item-actions">
          <span class="cart-item-total">$${(product.B_price * quantity).toFixed(2)}</span>
          <input type="number" min="1" max="20" value="${quantity}" data-id="${product.id}" class="cart-qty" aria-label="Quantity for ${escapeHTML(product.B_name)}" />
          <button class="remove-item-btn" data-id="${product.id}">Remove</button>
        </div>
      </div>`)
    .join("");

  renderTotals(data.totals);
}

async function refreshCart() {
  renderCartItems(await fetchJSON("/B_getcartitems"));
  await loadCartCount();
}

async function loadCartPage() {
  const itemsContainer = document.getElementById("cart-items");
  if (!itemsContainer) return;

  try {
    renderCartItems(await fetchJSON("/B_getcartitems"));
  } catch (err) {
    itemsContainer.innerHTML = "<p>Failed to load cart.</p>";
    return;
  }

  itemsContainer.addEventListener("change", async (e) => {
    const input = e.target.closest(".cart-qty");
    if (!input) return;

    const id = Number(input.dataset.id);
    const quantity = Number(input.value.trim());
    try {
      if (input.value.trim() !== "" && Number.isInteger(quantity) && quantity > 0) {
        await fetchJSON("/B_updateQuantity", { method: "PUT", body: JSON.stringify({ id, quantity }) });
      }
    } catch (err) {
      console.error("Update qty failed", err);
    }
    // Always re-render from the server so a bad or capped value snaps back to the real quantity.
    try {
      await refreshCart();
    } catch (err) {
      console.error("Refresh failed", err);
    }
  });

  itemsContainer.addEventListener("click", async (e) => {
    const btn = e.target.closest(".remove-item-btn");
    if (!btn) return;
    try {
      await fetchJSON("/B_removefromcart", { method: "DELETE", body: JSON.stringify({ id: Number(btn.dataset.id) }) });
      await refreshCart();
    } catch (err) {
      console.error("Remove failed", err);
    }
  });

  const checkoutBtn = document.getElementById("checkout-btn");
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", () => {
      // The quiz page handles an empty cart itself, and the server enforces the quiz gate at checkout.
      window.location.href = "/quiz";
    });
  }
}

// ===== CHECKOUT PAGE =====
function showFormError(message) {
  const box = document.getElementById("form-error");
  if (box) {
    box.textContent = message;
    box.hidden = !message;
    if (message) box.scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (message) {
    alert(message);
  }
}

async function loadCheckoutPage() {
  const form = document.getElementById("checkout-form");
  if (!form) return;

  // Gate: must be logged in AND have passed the quiz. The server is the source of truth for both.
  let user = null;
  try {
    user = (await fetchJSON("/B_session")).user;
    if (!user) {
      window.location.href = "/login?next=/checkout";
      return;
    }
    const status = await fetchJSON("/B_quizstatus");
    if (!status.passed) {
      window.location.href = "/quiz";
      return;
    }
  } catch (err) {
    console.error("Checkout guard failed", err);
    showFormError("Could not verify your session. Please refresh the page.");
    return;
  }

  const emailInput = document.getElementById("email");
  if (emailInput && !emailInput.value) emailInput.value = user.email || "";

  try {
    const data = await fetchJSON("/B_getcartitems");
    const items = data.items || [];
    renderTotals(data.totals);

    const list = document.getElementById("checkout-items");
    if (list) {
      list.innerHTML = items
        .map(({ product, quantity }) => `
          <div class="checkout-item">
            <img src="${escapeHTML(product.B_img)}" alt="${escapeHTML(product.B_name)}" class="checkout-item-image" />
            <div class="checkout-item-details">
              <h4>${escapeHTML(product.B_name)}</h4>
              <p>Qty: ${quantity} × $${product.B_price.toFixed(2)}</p>
            </div>
            <span class="checkout-item-price">$${(product.B_price * quantity).toFixed(2)}</span>
          </div>`)
        .join("");
    }
  } catch (err) {
    console.error("Failed to load checkout summary", err);
  }

  // Payment method toggle (also applied once on load).
  const cardDetails = document.getElementById("card-details");
  const syncPayment = () => {
    const method = form.querySelector('input[name="paymentMethod"]:checked').value;
    if (cardDetails) cardDetails.style.display = method === "paypal" ? "none" : "";
  };
  form.querySelectorAll('input[name="paymentMethod"]').forEach((r) => r.addEventListener("change", syncPayment));
  syncPayment();

  // Friendly input formatting.
  const cardInput = document.getElementById("cardNumber");
  if (cardInput) {
    cardInput.addEventListener("input", () => {
      const digits = cardInput.value.replace(/\D/g, "").slice(0, 19);
      cardInput.value = digits.replace(/(.{4})(?=.)/g, "$1 ");
    });
  }
  const expiryInput = document.getElementById("expiry");
  if (expiryInput) {
    expiryInput.addEventListener("input", () => {
      const d = expiryInput.value.replace(/\D/g, "").slice(0, 4);
      expiryInput.value = d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d;
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showFormError("");

    const submitBtn = form.querySelector(".place-order-btn");
    if (submitBtn.disabled) return; // blocks double-clicks
    submitBtn.disabled = true;

    const fd = new FormData(form);
    const paymentMethod = fd.get("paymentMethod");
    const customerInfo = {
      name: `${fd.get("firstName")} ${fd.get("lastName")}`.trim(),
      email: fd.get("email"),
      address: fd.get("address"),
      apartment: fd.get("apartment"),
      city: fd.get("city"),
      state: fd.get("state"),
      zip: fd.get("zip"),
      phone: fd.get("phone"),
      paymentMethod,
    };
    if (paymentMethod === "card") {
      customerInfo.cardNumber = fd.get("cardNumber");
      customerInfo.expiry = fd.get("expiry");
      customerInfo.cvv = fd.get("cvv");
    }

    try {
      const result = await fetchJSON("/B_checkout", { method: "POST", body: JSON.stringify({ customerInfo }) });
      window.location.href = `/confirmation?id=${encodeURIComponent(result.order.id)}`;
    } catch (err) {
      if (err.status === 401) {
        window.location.href = "/login?next=/checkout";
        return;
      }
      if (err.status === 403) {
        window.location.href = "/quiz";
        return;
      }
      showFormError(err.message || "Checkout failed. Please try again.");
      submitBtn.disabled = false;
    }
  });
}

// ===== MAIN =====
document.addEventListener("DOMContentLoaded", () => {
  setYear();
  loadCartCount();
  updateAuthLink();

  const page = document.body.dataset.page;
  if (page === "products") loadProductsPage();
  if (page === "cart") loadCartPage();
  if (page === "checkout") loadCheckoutPage();
});
