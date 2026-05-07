import express from "express";
import admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

const router = express.Router();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const COST_PER_MESSAGE = 18;

router.post("/chat", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: "No token" });
    }

    const token = authHeader.split(" ")[1];

    // 🔐 VERIFY USER
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    // 🔥 GET USER TOKENS
    const userRef = admin.firestore().collection("userTokens").doc(uid);
    const snap = await userRef.get();

    if (!snap.exists) {
      return res.status(403).json({ error: "No token account found" });
    }

    const userData = snap.data();
    const balance = userData.balance || 0;

    // 🚫 BLOCK if not enough tokens
    if (balance < COST_PER_MESSAGE) {
      return res.status(403).json({
        error: "NOT_ENOUGH_TOKENS",
      });
    }

    const { messages, context } = req.body;

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    const prompt = `
    Context:
    ${context || ""}

    Conversation:
    ${messages.map((m) => `${m.role}: ${m.text}`).join("\n")}
    `;

    const result = await model.generateContent(prompt);
    const reply = result.response.text();

    // 💰 DEDUCT TOKENS SECURELY
    await userRef.update({
      balance: admin.firestore.FieldValue.increment(-COST_PER_MESSAGE),
    });

    return res.json({ reply });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;