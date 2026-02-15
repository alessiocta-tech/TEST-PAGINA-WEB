import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mysql from "mysql2/promise";
import net from "net";
import https from "https";

const app = express();

// Railway usa un proxy davanti (X-Forwarded-For)
app.set("trust proxy", 1);

app.use(express.json({ limit: "200kb" }));
app.use(helmet());

// Rate limit
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* =========================
   DATABASE (SiteGround / altro)
========================= */

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT ?? 3306),
  connectTimeout: 10000,
  waitForConnections: true,
  connectionLimit: 10,
});

/* =========================
   API KEY
========================= */

function requireApiKey(req, res, next) {
  const apiKey = req.header("x-api-key");
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

/* =========================
   ROUTES
========================= */

app.get("/", (_req, res) => res.status(200).send("deRione API running"));

/**
 * IP pubblico di uscita del container (utile per whitelist SiteGround)
 */
app.get("/api/my-ip", (_req, res) => {
  const r = https.get("https://api.ipify.org?format=json", (resp) => {
    let data = "";
    resp.on("data", (chunk) => (data += chunk));
    resp.on("end", () => res.type("json").send(data));
  });

  r.on("error", (e) => res.status(500).json({ error: e.message }));
  r.setTimeout(5000, () => r.destroy(new Error("timeout")));
});

/**
 * Test puro TCP verso DB_HOST:DB_PORT (NON fa login MySQL)
 */
app.get("/api/tcp-test", (_req, res) => {
  const host = process.env.DB_HOST;
  const port = Number(process.env.DB_PORT ?? 3306);

  const socket = new net.Socket();
  const timeoutMs = 6000;

  const done = (payload) => {
    try {
      socket.destroy();
    } catch {}
    res.json(payload);
  };

  socket.setTimeout(timeoutMs);
  socket.on("connect", () => done({ ok: true, host, port, tcp: "open" }));
  socket.on("timeout", () => done({ ok: false, host, port, tcp: "timeout" }));
  socket.on("error", (e) =>
    done({
      ok: false,
      host,
      port,
      tcp: "error",
      code: e?.code ?? null,
      message: e?.message ?? null,
    })
  );

  socket.connect(port, host);
});

/**
 * Test MySQL (fa query SELECT 1)
 */
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "ok" });
  } catch (e) {
    res.status(500).json({
      ok: false,
      db: "down",
      code: e?.code ?? null,
      message: e?.message ?? null,
    });
  }
});

/**
 * Lista prenotazioni per ristorante e data
 * GET /api/reservations?restaurant_id=1&date=2024-11-19
 */
app.get("/api/reservations", requireApiKey, async (req, res) => {
  const { restaurant_id, date } = req.query;

  if (!restaurant_id || !date) {
    return res.status(400).json({ error: "missing_params" });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT *
       FROM Prenotazioni
       WHERE PRistorante = ? AND DataPren = ?
       ORDER BY OraPren ASC`,
      [Number(restaurant_id), date]
    );

    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({
      error: "db_error",
      code: e?.code ?? null,
      message: e?.message ?? null,
    });
  }
});

/**
 * Crea prenotazione
 */
app.post("/api/reservations", requireApiKey, async (req, res) => {
  const {
    restaurant_id,
    date,
    time,
    first_name,
    last_name = "",
    phone,
    email = "",
    covers,
    seggiolini = 0,
    fonte = "API",
    stato = "CONFERMATA",
    nota = "",
    prezzo = 0.0,
    tavolo = "",
    pcliente = 0,
    code_id = "",
  } = req.body ?? {};

  if (!restaurant_id || !date || !time || !first_name || !phone || !covers) {
    return res.status(400).json({ error: "missing_fields" });
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO Prenotazioni
        (PRistorante, DataPren, OraPren, Nome, Cognome,
         Telefono, Email, Coperti, Seggiolini,
         Fonte, Stato, Nota, Prezzo, Tavolo,
         PCliente, CodeID)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(restaurant_id),
        date,
        `${time}:00`,
        String(first_name).trim(),
        String(last_name).trim(),
        String(phone).trim(),
        String(email).trim(),
        Number(covers),
        Number(seggiolini),
        String(fonte),
        String(stato),
        String(nota),
        Number(prezzo),
        String(tavolo),
        Number(pcliente),
        String(code_id),
      ]
    );

    res.status(201).json({ id: result.insertId, message: "Reservation created" });
  } catch (e) {
    res.status(500).json({
      error: "db_error",
      code: e?.code ?? null,
      message: e?.message ?? null,
    });
  }
});

/* =========================
   START SERVER
========================= */

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => console.log(`Server running on port ${port}`));
