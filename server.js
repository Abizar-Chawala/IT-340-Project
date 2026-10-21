"use strict";

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const path = require("path");
const ANIMAL_QUESTIONS = require("./questions");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
const projectPath = path.join(__dirname, "public");
const SESSION_SECRET = process.env.SESSION_SECRET || "exotic-pets-demo-secret";

if (IS_PROD && !process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET must be set when NODE_ENV=production.");
  process.exit(1);
}

app.disable("x-powered-by");
if (IS_PROD) app.set("trust proxy", 1); // needed for secure cookies behind a TLS-terminating proxy

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 12,
    },
  })
);

app.use(express.static(projectPath));

// ===== DATA =====
const taxRate = 0.08;
const MAX_QTY = 20;
const PASS_RATIO = 0.6;
const MAX_QUIZ_QUESTIONS = 5;

const products = [
  { id: 1, B_name: "Blue-Tongued Skink", B_price: 349.99, B_desc: "A friendly, hardy lizard known for its bright blue tongue and calm personality. Great for beginners.", B_img: "/images/Skink.jpg" },
  { id: 2, B_name: "Panther Chameleon", B_price: 429.99, B_desc: "Colorful chameleon that changes colors based on mood and environment.", B_img: "/images/Chameleon.jpg" },
  { id: 3, B_name: "Ball Python", B_price: 199.99, B_desc: "Docile snake that is easy to handle and care for.", B_img: "/images/Python.jpg" },
  { id: 4, B_name: "Fennec Fox", B_price: 1299.99, B_desc: "Small desert fox with huge ears and a playful personality.", B_img: "/images/Fox.jpg" },
  { id: 5, B_name: "Sulcata Tortoise", B_price: 399.99, B_desc: "Long-lived tortoise that can grow quite large; best for experienced keepers.", B_img: "/images/Tortoise.jpg" },
  { id: 6, B_name: "Blue-and-Gold Macaw", B_price: 2499.99, B_desc: "Large, intelligent parrot with striking blue and yellow feathers.", B_img: "/images/Macaw.jpg" },
  { id: 7, B_name: "Ring-Tailed Cat", B_price: 799.99, B_desc: "Agile, curious mammal with a distinctive ringed tail.", B_img: "/images/RingTailedCat.jpg" },
  { id: 8, B_name: "Tanuki (Raccoon Dog)", B_price: 899.99, B_desc: "Mischievous and fluffy canid with a raccoon-like mask.", B_img: "/images/Tanuki.jpg" },
  { id: 9, B_name: "Sugar Glider", B_price: 249.99, B_desc: "Tiny nocturnal gliding marsupial that loves to climb and glide.", B_img: "/images/Glider.jpg" },
  { id: 10, B_name: "Bengal Cat", B_price: 1199.99, B_desc: "Spotted cat with wild-looking patterns and high energy.", B_img: "/images/BengalCat.jpg" },
  { id: 11, B_name: "Sphynx Cat", B_price: 1399.99, B_desc: "Hairless cat with big ears and super affectionate behavior.", B_img: "/images/SphynxCat.jpg" },
  { id: 12, B_name: "Capuchin Monkey", B_price: 4999.99, B_desc: "Highly intelligent primate; requires experienced, committed owners.", B_img: "/images/Monkey.jpg" },
];

const users = [];
const orders = [];
let nextUserId = 1;
let nextOrderId = 1;

// Used so login takes the same time whether or not the email exists (prevents account enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

// ===== HELPERS =====
function getSessionCart(req) {
  if (!Array.isArray(req.session.cart)) req.session.cart = [];
  return req.session.cart;
}

function getSessionUser(req) {
  return req.session.user || null;
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function moneyToCents(value) {
  return Math.round(Number(value) * 100);
}

/** Cart entries joined with their product; invalid/unknown entries are dropped. */
function getCartItems(req) {
  return getSessionCart(req)
    .map((entry) => {
      const id = Number(entry && entry.id);
      const quantity = Number(entry && entry.quantity);
      if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(quantity) || quantity <= 0) return null;
      const product = products.find((p) => p.id === id);
      if (!product) return null;
      return { id, quantity: Math.min(quantity, MAX_QTY), product };
    })
    .filter(Boolean);
}

/** One place that computes money, in integer cents, so every page and the order agree to the cent. */
function computeTotals(items) {
  const subtotalCents = items.reduce((sum, item) => sum + moneyToCents(item.product.B_price) * item.quantity, 0);
  const taxCents = Math.round(subtotalCents * taxRate);
  const totalCents = subtotalCents + taxCents;
  return {
    subtotal: subtotalCents / 100,
    tax: taxCents / 100,
    total: totalCents / 100,
  };
}

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===== QUIZ LOGIC =====
function cartProductIds(items) {
  return [...new Set(items.map((item) => item.id))].sort((a, b) => a - b);
}

/**
 * Picks questions so EVERY animal in the cart is tested at least once
 * (round-robin across animals), up to MAX_QUIZ_QUESTIONS (or one per animal if there are more animals).
 */
function buildQuizPicks(items) {
  const names = [...new Set(items.map((item) => item.product.B_name))];
  const pools = names
    .map((name) => ({
      name,
      order: shuffle((ANIMAL_QUESTIONS[name] || []).map((_, index) => index)),
    }))
    .filter((pool) => pool.order.length > 0);

  const cap = Math.max(MAX_QUIZ_QUESTIONS, pools.length);
  const picks = [];
  for (let round = 0; picks.length < cap; round++) {
    let added = false;
    for (const pool of pools) {
      if (picks.length >= cap) break;
      if (round < pool.order.length) {
        picks.push({ animal: pool.name, index: pool.order[round] });
        added = true;
      }
    }
    if (!added) break;
  }
  return shuffle(picks);
}

function passNeededFor(total) {
  return Math.ceil(total * PASS_RATIO);
}

function isQuizPassedForCart(req, items) {
  const quiz = req.session.quiz;
  if (!quiz || !quiz.passed || items.length === 0) return false;
  // Every animal currently in the cart must have been covered by the passed quiz.
  return cartProductIds(items).every((id) => quiz.productIds.includes(id));
}

// ===== PAGE ROUTES =====
const pages = {
  "/": "index.html",
  "/cart": "cart.html",
  "/checkout": "checkout.html",
  "/confirmation": "confirmation.html",
  "/login": "login.html",
  "/care-guide": "care-guide.html",
  "/quiz": "quiz.html",
};
Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (req, res) => res.sendFile(path.join(projectPath, file)));
});

// ===== AUTH =====
function signIn(req, res, next, user) {
  // New session id on privilege change (prevents session fixation); keep the shopper's cart.
  const cart = getSessionCart(req).slice();
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.cart = cart;
    req.session.user = publicUser(user);
    res.json({ success: true, user: req.session.user });
  });
}

app.get("/B_session", (req, res) => {
  res.json({ user: getSessionUser(req) });
});

app.post("/B_register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields required." });
    }

    const cleanName = String(name).trim();
    const normalizedEmail = String(email).trim().toLowerCase();
    const rawPassword = String(password);

    if (cleanName.length === 0 || cleanName.length > 100) {
      return res.status(400).json({ success: false, message: "Enter a name (100 characters max)." });
    }
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }
    if (rawPassword.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
    }
    if (Buffer.byteLength(rawPassword, "utf8") > 72) {
      return res.status(400).json({ success: false, message: "Password is too long (72 bytes max)." });
    }
    if (users.some((u) => u.email === normalizedEmail)) {
      return res.status(400).json({ success: false, message: "Email already registered." });
    }

    const passwordHash = await bcrypt.hash(rawPassword, 10);

    // Re-check after the await: two simultaneous sign-ups could both have passed the check above.
    if (users.some((u) => u.email === normalizedEmail)) {
      return res.status(400).json({ success: false, message: "Email already registered." });
    }

    const user = { id: nextUserId++, name: cleanName, email: normalizedEmail, passwordHash };
    users.push(user);
    signIn(req, res, next, user);
  } catch (err) {
    next(err);
  }
});

app.post("/B_login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "All fields required." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = users.find((entry) => entry.email === normalizedEmail);
    const matches = await bcrypt.compare(String(password), user ? user.passwordHash : DUMMY_HASH);
    if (!user || !matches) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    signIn(req, res, next, user);
  } catch (err) {
    next(err);
  }
});

app.post("/B_logout", (req, res, next) => {
  const cart = getSessionCart(req).slice();
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.cart = cart; // logging out should not empty the cart
    res.json({ success: true });
  });
});

// ===== PRODUCTS & CART =====
app.get("/B_getproducts", (req, res) => {
  res.json({ products, taxRate });
});

app.post("/B_addtocart", (req, res) => {
  const cart = getSessionCart(req);
  const { id, quantity } = req.body || {};
  const productId = parseId(id);
  const qty = Number(quantity);

  if (!productId || !products.some((p) => p.id === productId)) {
    return res.status(400).json({ success: false, message: "Invalid product selected." });
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ success: false, message: "Quantity must be a whole number greater than zero." });
  }

  const existing = cart.find((item) => Number(item.id) === productId);
  if (existing) {
    existing.quantity = Math.min(existing.quantity + qty, MAX_QTY);
  } else {
    cart.push({ id: productId, quantity: Math.min(qty, MAX_QTY) });
  }
  res.json({ success: true, cart });
});

app.get("/B_getcartcount", (req, res) => {
  const count = getCartItems(req).reduce((sum, item) => sum + item.quantity, 0);
  res.json({ count });
});

app.get("/B_getcartitems", (req, res) => {
  const items = getCartItems(req);
  res.json({ items, taxRate, totals: computeTotals(items) });
});

app.put("/B_updateQuantity", (req, res) => {
  const cart = getSessionCart(req);
  const { id, quantity } = req.body || {};
  const productId = parseId(id);
  const qty = Number(quantity);

  if (!productId) {
    return res.status(400).json({ success: false, message: "Invalid product selected." });
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ success: false, message: "Quantity must be a whole number greater than zero." });
  }

  const existing = cart.find((item) => Number(item.id) === productId);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Item not in cart" });
  }

  existing.quantity = Math.min(qty, MAX_QTY);
  res.json({ success: true, cart });
});

app.delete("/B_removefromcart", (req, res) => {
  const { id } = req.body || {};
  const productId = parseId(id);
  if (!productId) {
    return res.status(400).json({ success: false, message: "Invalid product selected." });
  }

  req.session.cart = getSessionCart(req).filter((item) => Number(item.id) !== productId);
  res.json({ success: true, cart: req.session.cart });
});

// ===== QUIZ =====
// The server picks the questions, remembers them in the session, and grades them.
// Correct answers are NOT sent to the browser until the quiz has been submitted.
app.get("/B_getquiz", (req, res) => {
  const items = getCartItems(req);
  if (items.length === 0) {
    return res.status(400).json({ success: false, message: "Your cart is empty." });
  }

  const picks = buildQuizPicks(items);
  if (picks.length === 0) {
    return res.status(400).json({ success: false, message: "No quiz questions exist for the items in your cart." });
  }

  req.session.quiz = { productIds: cartProductIds(items), picks, passed: false, submitted: false };

  res.json({
    success: true,
    animals: [...new Set(items.map((item) => item.product.B_name))],
    passNeeded: passNeededFor(picks.length),
    questions: picks.map(({ animal, index }) => {
      const entry = ANIMAL_QUESTIONS[animal][index];
      return { animal, q: entry.q, options: entry.options };
    }),
  });
});

app.post("/B_submitquiz", (req, res) => {
  const items = getCartItems(req);
  if (items.length === 0) {
    return res.status(400).json({ success: false, message: "Your cart is empty." });
  }

  const quiz = req.session.quiz;
  if (!quiz) {
    return res.status(409).json({ success: false, message: "Please start the quiz first." });
  }
  if (quiz.submitted) {
    return res.status(409).json({ success: false, message: "This quiz was already submitted. Start a new one." });
  }
  // The cart gained an animal since the quiz was generated, so it must be retaken.
  if (!cartProductIds(items).every((id) => quiz.productIds.includes(id))) {
    return res.status(409).json({ success: false, message: "Your cart changed. Please retake the quiz." });
  }

  const answers = req.body && req.body.answers;
  const valid =
    Array.isArray(answers) &&
    answers.length === quiz.picks.length &&
    answers.every((a, i) => {
      const options = ANIMAL_QUESTIONS[quiz.picks[i].animal][quiz.picks[i].index].options;
      return Number.isInteger(a) && a >= 0 && a < options.length;
    });
  if (!valid) {
    return res.status(400).json({ success: false, message: "Please answer every question." });
  }

  let score = 0;
  const review = quiz.picks.map(({ animal, index }, i) => {
    const entry = ANIMAL_QUESTIONS[animal][index];
    const isCorrect = answers[i] === entry.correct;
    if (isCorrect) score += 1;
    return {
      animal,
      q: entry.q,
      options: entry.options,
      yourAnswer: answers[i],
      correct: entry.correct,
      isCorrect,
      explain: entry.explain,
    };
  });

  const total = quiz.picks.length;
  const passNeeded = passNeededFor(total);
  quiz.passed = score >= passNeeded;
  quiz.submitted = true;

  res.json({ success: true, passed: quiz.passed, score, total, passNeeded, review });
});

app.get("/B_quizstatus", (req, res) => {
  res.json({ passed: isQuizPassedForCart(req, getCartItems(req)) });
});

// ===== CHECKOUT =====
function normalizeExpiry(raw) {
  const match = String(raw || "").trim().match(/^(0[1-9]|1[0-2])\s*\/?\s*(\d{2})$/);
  return match ? { month: Number(match[1]), year: 2000 + Number(match[2]), text: `${match[1]}/${match[2]}` } : null;
}

function validateCheckout(info) {
  const str = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const clean = {
    name: str(info.name, 100),
    email: str(info.email, 254).toLowerCase(),
    address: str(info.address),
    apartment: str(info.apartment),
    city: str(info.city, 100),
    state: str(info.state, 50).toUpperCase(),
    zip: str(info.zip, 20),
    phone: str(info.phone, 30),
    paymentMethod: str(info.paymentMethod, 20),
  };

  if (!clean.name) return { error: "Please enter your name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) return { error: "Please enter a valid email address." };
  if (!clean.address) return { error: "Please enter your street address." };
  if (!clean.city) return { error: "Please enter your city." };
  if (!/^[A-Z]{2}$/.test(clean.state)) return { error: "Please enter your 2-letter state code (e.g. NJ)." };
  if (!/^\d{5}(-\d{4})?$/.test(clean.zip)) return { error: "Please enter a valid ZIP code." };
  const phoneDigits = clean.phone.replace(/\D/g, "");
  if (phoneDigits.length < 10 || phoneDigits.length > 15) return { error: "Please enter a valid phone number." };
  if (!["card", "paypal"].includes(clean.paymentMethod)) return { error: "Please choose a payment method." };

  let last4 = null;
  if (clean.paymentMethod === "card") {
    const cardNumber = String(info.cardNumber || "").replace(/\s+/g, "");
    if (!/^\d{13,19}$/.test(cardNumber)) return { error: "Please enter a valid card number." };

    const expiry = normalizeExpiry(info.expiry);
    if (!expiry) return { error: "Please enter a valid expiration date in MM/YY format." };
    const now = new Date();
    if (expiry.year < now.getFullYear() || (expiry.year === now.getFullYear() && expiry.month < now.getMonth() + 1)) {
      return { error: "That card has expired." };
    }

    if (!/^\d{3,4}$/.test(String(info.cvv || "").trim())) return { error: "Please enter a valid security code." };
    last4 = cardNumber.slice(-4);
  }

  return { clean, last4 };
}

app.post("/B_checkout", (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: "Please log in before checking out." });
  }

  const items = getCartItems(req);
  if (items.length === 0) {
    return res.status(400).json({ success: false, message: "Your cart is empty." });
  }

  if (!isQuizPassedForCart(req, items)) {
    return res.status(403).json({ success: false, message: "You must complete and pass the care quiz for your cart before checkout." });
  }

  const { clean, last4, error } = validateCheckout((req.body && req.body.customerInfo) || {});
  if (error) {
    return res.status(400).json({ success: false, message: error });
  }

  const totals = computeTotals(items);
  const order = {
    id: nextOrderId++,
    userId: user.id,
    items: items.map((item) => ({
      id: item.id,
      name: item.product.B_name,
      price: item.product.B_price,
      quantity: item.quantity,
    })),
    ...totals,
    email: clean.email,
    shipping: {
      name: clean.name,
      address: clean.address,
      apartment: clean.apartment,
      city: clean.city,
      state: clean.state,
      zip: clean.zip,
      phone: clean.phone,
    },
    // Never store or return full card numbers or CVVs.
    payment: { method: clean.paymentMethod, last4 },
    createdAt: new Date().toISOString(),
  };

  orders.push(order);
  req.session.cart = [];
  req.session.quiz = null;

  res.json({ success: true, order });
});

app.get("/B_getorders", (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: "You must log in to view your orders." });
  }

  let customerOrders = orders.filter((order) => order.userId === user.id);
  if (req.query.id !== undefined) {
    customerOrders = customerOrders.filter((order) => String(order.id) === String(req.query.id));
  }
  res.json({ success: true, orders: customerOrders });
});

// ===== FALLBACKS =====
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Not found." });
});

app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Malformed JSON." });
  }
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, message: "Server error." });
});

app.listen(PORT, () => {
  console.log("========================================");
  console.log("🦎 Exotic Pets E-Commerce Backend");
  console.log("========================================");
  console.log(`Server:  http://localhost:${PORT}`);
  console.log(`Products: ${products.length} exotic pets`);
  console.log(`Tax Rate: ${taxRate * 100}%`);
  console.log("========================================");
});
