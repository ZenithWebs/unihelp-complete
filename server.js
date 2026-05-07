import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import admin, { db } from "./firebase.js";
import rateLimit from "express-rate-limit";
import aiRoutes from "./routes/ai.js";
import paymentRoutes from "./routes/payment.js";
import webhookRoutes from "./routes/webhook.js";

dotenv.config();

const app = express();

// ================= CORS =================
app.use(
  cors({
    origin: [
      "https://unihelp-flax.vercel.app",
      "http://localhost:5173",
    ],
    credentials: true,
  })
);

// ================= WEBHOOK FIRST =================
// 🔥 IMPORTANT: MUST COME BEFORE express.json()
app.use("/api", webhookRoutes);

// ================= JSON =================
app.use(express.json());

// ================= RATE LIMIT =================
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
  })
);

// ================= ROUTES =================
app.use("/api/ai", aiRoutes);
app.use("/api", paymentRoutes);

// ================= START =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});