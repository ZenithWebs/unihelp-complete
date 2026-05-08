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

import axios from "axios";

router.post("/verify-payment", async (req, res) => {
  try {
    const { transaction_id } = req.body;

    if (!transaction_id) {
      return res.status(400).json({
        error: "Missing transaction ID",
      });
    }

    // VERIFY FLUTTERWAVE PAYMENT
    const verify = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
        },
      }
    );

    const tx = verify.data.data;

    if (tx.status !== "successful") {
      return res.status(400).json({
        error: "Payment not successful",
      });
    }

    const meta = tx.meta;

    if (!meta?.userId || !meta?.tokens) {
      return res.status(400).json({
        error: "Invalid payment metadata",
      });
    }

    const ref = admin
      .firestore()
      .collection("userTokens")
      .doc(meta.userId);

    // ADD TOKENS
    await ref.set(
      {
        balance: admin.firestore.FieldValue.increment(
          Number(meta.tokens)
        ),
      },
      { merge: true }
    );

    return res.json({
      success: true,
      tokensAdded: meta.tokens,
    });

  } catch (err) {
    console.log("VERIFY PAYMENT ERROR:", err.message);

    return res.status(500).json({
      error: "Verification failed",
    });
  }
});

export default router;