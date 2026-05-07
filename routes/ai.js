import express from "express";
import admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

const router = express.Router();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const COST_PER_MESSAGE = 18;

// ============================
// 🤖 AI CHAT ROUTE
// ============================
router.post("/chat", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    // ============================
    // 🔐 VERIFY FIREBASE USER
    // ============================
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    const userRef = admin.firestore().collection("userTokens").doc(uid);

    // ============================
    // 🔥 ATOMIC TRANSACTION (IMPORTANT)
    // prevents double spending
    // ============================
    const result = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);

      if (!snap.exists) {
        throw new Error("NO_ACCOUNT");
      }

      const balance = snap.data().balance || 0;

      // 🚫 BLOCK IF INSUFFICIENT TOKENS
      if (balance < COST_PER_MESSAGE) {
        throw new Error("NOT_ENOUGH_TOKENS");
      }

      const { messages = [], context = "" } = req.body;

      // ============================
      // 🤖 CALL GEMINI AI
      // ============================
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
      });

      const prompt = `
Context:
${context}

Conversation:
${messages.map((m) => `${m.role}: ${m.text}`).join("\n")}
`;

      const aiResult = await model.generateContent(prompt);
      const reply = aiResult.response.text();

      // ============================
      // 💰 DEDUCT TOKENS SAFELY
      // ============================
      tx.update(userRef, {
        balance: admin.firestore.FieldValue.increment(-COST_PER_MESSAGE),
      });

      return {
        reply,
        newBalance: balance - COST_PER_MESSAGE,
      };
    });

    return res.json(result);
  } catch (err) {
    console.log("AI ERROR:", err.message);

    if (err.message === "NOT_ENOUGH_TOKENS") {
      return res.status(403).json({
        error: "NOT_ENOUGH_TOKENS",
      });
    }

    if (err.message === "NO_ACCOUNT") {
      return res.status(403).json({
        error: "NO_TOKEN_ACCOUNT",
      });
    }

    return res.status(500).json({
      error: "Server error",
    });
  }
});

export default router;