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
      const secretHash = process.env.FLW_SECRET_HASH;
      const signature = req.headers["verif-hash"];

      if (!signature || signature !== secretHash) {
        return res.sendStatus(401);
      }

      const payload = JSON.parse(req.body.toString());

      if (payload.event !== "charge.completed") {
        return res.sendStatus(200);
      }

      const data = payload.data;

      if (data.status !== "successful") {
        return res.sendStatus(200);
      }

      const txRef = data.tx_ref;

      // prevent duplicate
      const txDoc = db.collection("transactions").doc(txRef);
      const exists = await txDoc.get();

        if (exists.exists) {
          console.log("Already processed");
          return res.sendStatus(200);
        }
      // verify
      const verify = await axios.get(
        `https://api.flutterwave.com/v3/transactions/${data.id}/verify`,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          },
        }
      );

      const tx = verify.data.data;

      const meta = tx.meta;

      if (!meta?.userId || !meta?.tutorialId) {
        return res.sendStatus(400);
      }

      // 🔥 SAVE PURCHASE (THIS IS WHAT UNLOCKS TUTORIAL)
      await db.collection("purchases").add({
        userId: meta.userId,
        tutorialId: meta.tutorialId,
        tutorId: meta.tutorId,
        amount: meta.amount,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await txDoc.set({
        status: "processed",
      });

      console.log("✅ PURCHASE SAVED");

      return res.sendStatus(200);
    } catch (err) {
      console.log("WEBHOOK ERROR:", err.message);
      return res.sendStatus(500);
    }
  }
);

export default router;