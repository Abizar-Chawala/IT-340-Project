# Exotic Pets Store

A demo e-commerce website for exotic pets. This project is a browser-based storefront with a Node/Express backend, a cart, quiz gate, login, and order checkout flow.

## Run locally

1. Install dependencies:
   npm install
2. Start the app:
   npm start
3. Open http://localhost:3000

## Project layout

    server.js        Express backend (API + page routes)
    questions.js     Quiz question bank (server-side only)
    public/          index, cart, quiz, checkout, confirmation, login, care-guide, styles.css, script.js, images/

## Notes

- Set `SESSION_SECRET` (and `NODE_ENV=production`) when deploying; the server refuses to start in production without it.

- The app keeps its data in memory, so orders, users, and cart state reset when the server restarts.
- Login and cart state are stored in browser sessions using Express sessions.
- Quiz questions are chosen and graded by the server; every animal in the cart is tested. The quiz must be passed (and checkout requires login) before an order can be placed.
- Full card numbers and CVVs are never stored; orders keep only the last 4 digits.
- This is a demo app and does not process real payments or send real emails.

