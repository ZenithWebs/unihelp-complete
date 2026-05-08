import express from "express";
import admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import "dotenv/config";

const router = express.Router();

const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY
);

const COST_PER_MESSAGE = 18;
const FREE_DAILY_MESSAGES = 5;

/* =========================================================
   GET TODAY STRING
========================================================= */
const getToday = () => {
  return new Date().toISOString().split("T")[0];
};

/* =========================================================
   AI CHAT
========================================================= */
router.post("/chat", async (req, res) => {
  try {
    const authHeader =
      req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: "No token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    // VERIFY USER
    const decoded =
      await admin.auth().verifyIdToken(token);

    const uid = decoded.uid;

    const userRef = admin
      .firestore()
      .collection("userTokens")
      .doc(uid);

    /* =========================================================
       TRANSACTION
    ========================================================= */
    const result =
      await admin
        .firestore()
        .runTransaction(async (tx) => {
          const snap = await tx.get(userRef);

          let data = {};

          if (snap.exists) {
            data = snap.data();
          }

          let balance =
            data.balance || 0;

          let freeUsed =
            data.freeMessagesUsed || 0;

          let freeDate =
            data.freeMessagesDate || "";

          const today = getToday();

          // RESET DAILY FREE COUNT
          if (freeDate !== today) {
            freeUsed = 0;
          }

          const hasFreeMessages =
            freeUsed < FREE_DAILY_MESSAGES;

          const hasPaidTokens =
            balance >= COST_PER_MESSAGE;

          // BLOCK USER
          if (
            !hasFreeMessages &&
            !hasPaidTokens
          ) {
            throw new Error(
              "LIMIT_REACHED"
            );
          }

          const {
            messages = [],
            context = "",
          } = req.body;

          /* =========================================================
             GEMINI
          ========================================================= */
          const model =
            genAI.getGenerativeModel({
              model: "gemini-2.5-flash",
            });

          const prompt = `
Context:
${context}

Conversation:
${messages
  .map(
    (m) =>
      `${m.role}: ${m.text}`
  )
  .join("\n")}
`;

          const aiResult =
            await model.generateContent(
              prompt
            );

          const reply =
            aiResult.response.text();

          /* =========================================================
             FREE OR PAID
          ========================================================= */

          // USE FREE MESSAGE
          if (hasFreeMessages) {
            tx.set(
              userRef,
              {
                freeMessagesUsed:
                  freeUsed + 1,

                freeMessagesDate:
                  today,

                balance,
              },
              { merge: true }
            );

            return {
              reply,

              freeMode: true,

              freeLeft:
                FREE_DAILY_MESSAGES -
                (freeUsed + 1),

              balance,
            };
          }

          // USE PAID TOKENS
          tx.set(
            userRef,
            {
              balance:
                balance -
                COST_PER_MESSAGE,

              freeMessagesUsed:
                freeUsed,

              freeMessagesDate:
                today,
            },
            { merge: true }
          );

          return {
            reply,

            freeMode: false,

            balance:
              balance -
              COST_PER_MESSAGE,
          };
        });

    return res.json(result);
  } catch (err) {
    console.log(
      "AI ERROR:",
      err.message
    );

    if (
      err.message === "LIMIT_REACHED"
    ) {
      return res.status(403).json({
        error: "FREE_LIMIT_REACHED",
        message:
          "You have used your 5 free AI messages today. Upgrade to continue.",
      });
    }

    return res.status(500).json({
      error: "Server error",
    });
  }
});

/* =========================================================
   VERIFY PAYMENT
========================================================= */
router.post(
  "/verify-payment",
  async (req, res) => {
    try {
      const { transaction_id } =
        req.body;

      if (!transaction_id) {
        return res.status(400).json({
          error:
            "Missing transaction ID",
        });
      }

      const verify =
        await axios.get(
          `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
          {
            headers: {
              Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            },
          }
        );

      const tx =
        verify.data.data;

      if (
        tx.status !== "successful"
      ) {
        return res.status(400).json({
          error:
            "Payment not successful",
        });
      }

      const meta = tx.meta;

      if (
        !meta?.userId ||
        !meta?.tokens
      ) {
        return res.status(400).json({
          error:
            "Invalid payment metadata",
        });
      }

      const ref = admin
        .firestore()
        .collection("userTokens")
        .doc(meta.userId);

      await ref.set(
        {
          balance:
            admin.firestore.FieldValue.increment(
              Number(meta.tokens)
            ),
        },
        { merge: true }
      );

      return res.json({
        success: true,
        tokensAdded:
          meta.tokens,
      });
    } catch (err) {
      console.log(
        "VERIFY PAYMENT ERROR:",
        err.message
      );

      return res.status(500).json({
        error:
          "Verification failed",
      });
    }
  }
);

export default router;