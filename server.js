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

function requireApiKey(req, res, next) {
  const apiKey = req.header("x-api-key");
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "ok" });
  } catch {
    res.status(500).json({ ok: false, db: "down" });
  }
});

// Lista prenotazioni (ristorante + data)
app.get("/api/reservations", requireApiKey, async (req, res) => {
  const { restaurant_id, date } = req.query;
  if (!restaurant_id || !date) {
    return res.status(400).json({ error: "missing_params" });
  }

  const [rows] = await pool.execute(
    `SELECT
      ID, PRistorante, DataPren, OraPren, Nome, Cognome, Telefono, Email,
      Coperti, Seggiolini, Fonte, Stato, Nota, Prezzo, Tavolo, PCliente, CodeID,
      Voto, Commento, DataReg, DataUpd
     FROM Prenotazioni
     WHERE PRistorante = ? AND DataPren = ?
     ORDER BY OraPren ASC`,
    [Number(restaurant_id), date]
  );

  res.json({ items: rows });
});

// Crea prenotazione
app.post("/api/reservations", requireApiKey, async (req, res) => {
  const {
    restaurant_id,
    date,         // YYYY-MM-DD
    time,         // HH:MM
    first_name,
    last_name = "",
    phone,
    email = "",
    covers,
    seggiolini = 0,
    fonte = "elevenlabs",
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
  port: Number(process.env.DB_PORT ?? 3306),


  // Normalizzazioni minime
  const oraPren = `${time}:00`; // TIME
  const payload = {
    PRistorante: Number(restaurant_id),
    DataPren: date,
    OraPren: oraPren,
    Nome: String(first_name).trim(),
    Cognome: String(last_name).trim(),
    Telefono: String(phone).trim(),
    Email: String(email ?? "").trim(),
    Coperti: Number(covers),
    Seggiolini: Number(seggiolini),
    Fonte: String(fonte).slice(0, 15),
    Stato: String(stato).slice(0, 15),
    Nota: String(nota).slice(0, 500),
    Prezzo: Number(prezzo),
    Tavolo: String(tavolo).slice(0, 5),
    PCliente: Number(pcliente),
    CodeID: String(code_id).slice(0, 50),
  };

  const [result] = await pool.execute(
    `INSERT INTO Prenotazioni
     (PRistorante, DataPren, OraPren, Nome, Cognome, Telefono, Email, Coperti, Seggiolini,
      Fonte, Stato, Nota, Prezzo, Tavolo, PCliente, CodeID)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.PRistorante,
      payload.DataPren,
      payload.OraPren,
      payload.Nome,
      payload.Cognome,
      payload.Telefono,
      payload.Email,
      payload.Coperti,
      payload.Seggiolini,
      payload.Fonte,
      payload.Stato,
      payload.Nota,
      payload.Prezzo,
      payload.Tavolo,
      payload.PCliente,
      payload.CodeID,
    ]
  );

  res.status(201).json({
    id: result.insertId,
    ...payload,
  });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`API listening on :${port}`));
