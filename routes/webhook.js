import express from "express";
import axios from "axios";
import admin from "firebase-admin";
import { db } from "../firebase.js";

const router = express.Router();

router.post(
  "/payment/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature = req.headers["verif-hash"];

      if (signature !== process.env.FLW_SECRET_HASH) {
        console.log("❌ Invalid signature");
        return res.sendStatus(401);
      }

      const payload = JSON.parse(req.body.toString());

      console.log("🔥 WEBHOOK RECEIVED");

      if (payload.event !== "charge.completed") {
        return res.sendStatus(200);
      }

      const data = payload.data;

      if (data.status !== "successful") {
        return res.sendStatus(200);
      }

      // verify transaction
      const verifyRes = await axios.get(
        `https://api.flutterwave.com/v3/transactions/${data.id}/verify`,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          },
        }
      );

      const transaction = verifyRes.data.data;

      const meta = transaction.meta;

      console.log("META:", meta);

      if (!meta?.userId || !meta?.tutorialId) {
        console.log("❌ Missing metadata");
        return res.sendStatus(400);
      }

      // prevent duplicate
      const txRef = transaction.tx_ref;

      const txDoc = db.collection("transactions").doc(txRef);

      const exists = await txDoc.get();

      if (exists.exists) {
        console.log("⚠️ Already processed");
        return res.sendStatus(200);
      }

      // SAVE PURCHASE
      await db.collection("purchases").add({
        userId: meta.userId,
        tutorialId: meta.tutorialId,
        tutorId: meta.tutorId || "",
        amount: meta.amount || 0,
        createdAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("✅ PURCHASE SAVED");

      // mark processed
      await txDoc.set({
        processed: true,
        createdAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.sendStatus(200);

    } catch (err) {
      console.log("❌ WEBHOOK ERROR:", err.message);
      return res.sendStatus(500);
    }
  }
);

export default router;