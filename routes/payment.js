import express from "express";
import axios from "axios";
import admin from "firebase-admin";

const router = express.Router();

router.post("/pay", async (req, res) => {
  try {
    const { amount, email, tutorialId, tutorId, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const payload = {
      tx_ref: "tx_" + Date.now(),
      amount,
      currency: "NGN",

      redirect_url:
        "https://unihelp-flax.vercel.app/tutorialmarketplace?status=successful",

      webhook_url:
        "https://unihelp-complete.onrender.com/api/payment/webhook",

      customer: { email },

      meta: {
        userId,
        tutorId,
        tutorialId,
        amount,
      },
    };

    const response = await axios.post(
      "https://api.flutterwave.com/v3/payments",
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
        },
      }
    );

    return res.json(response.data);
  } catch (err) {
    console.log("PAY ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Payment failed" });
  }
});

export default router;