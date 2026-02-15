import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mysql from "mysql2/promise";

const app = express();

app.use(express.json({ limit: "200kb" }));
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* =========================
   DATABASE CONNECTION
========================= */

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT ?? 3306),
  connectTimeout: 10000
});

/* =========================
   API KEY MIDDLEWARE
========================= */

function requireApiKey(req, res, next) {
  const apiKey = req.header("x-api-key");
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

/* =========================
   ROOT
========================= */

app.get("/", (_req, res) => {
  res.status(200).send("deRione API running");
});

/* =========================
   HEALTH CHECK
========================= */

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "ok" });
  } catch (e) {
    res.status(500).json({
      ok: false,
      db: "down",
      code: e?.code ?? null,
      message: e?.message ?? null
    });
  }
});

/* =========================
   LIST RESERVATIONS
========================= */

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
    res.status(500).json({ error: e.message });
  }
});

/* =========================
   CREATE RESERVATION
========================= */

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
        first_name.trim(),
        last_name.trim(),
        phone.trim(),
        email.trim(),
        Number(covers),
        Number(seggiolini),
        fonte,
        stato,
        nota,
        Number(prezzo),
        tavolo,
        Number(pcliente),
        code_id
      ]
    );

    res.status(201).json({
      id: result.insertId,
      message: "Reservation created"
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================
   START SERVER
========================= */

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
