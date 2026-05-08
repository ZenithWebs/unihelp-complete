import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import admin, { db } from "./firebase.js";
import rateLimit from "express-rate-limit";
import aiRoutes from "./routes/ai.js";
import paymentRoutes from "./routes/payment.js";
import webhookRoutes from "./routes/webhook.js";
import flutterwaveRoutes from "./routes/flutterwave.js";
import cron from "node-cron";

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
app.use("/api", flutterwaveRoutes);
// ================= START =================

cron.schedule("0 * * * *", async () => {
  console.log("⏰ Checking inactive users...");

  const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;

  const snap = await db.collection("users").get();

  snap.forEach(async (docSnap) => {
    const user = docSnap.data();

    if (!user.lastActive || !user.fcmToken) return;

    const last =
      user.lastActive.toDate().getTime();

    if (last < twelveHoursAgo) {
      try {
        await admin.messaging().send({
          token: user.fcmToken,
          notification: {
            title: "We miss you 👋",
            body: "Come back and continue learning.",
          },
        });

        console.log("✅ Notification sent");
      } catch (err) {
        console.log(err.message);
      }
    }
  });
});

app.get('/', (res, req) => {
  res.send('Unihelp backend is running')
})