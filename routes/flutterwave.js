import express from "express";
import admin from "firebase-admin";

const router = express.Router();

router.post("/webhook", async (req, res) => {
  try {
    const secretHash = process.env.FLW_SECRET_HASH;

    if (req.headers["verif-hash"] !== secretHash) {
      return res.status(401).end();
    }

    const payload = req.body;

    if (
      payload.event === "charge.completed" &&
      payload.data.status === "successful"
    ) {
      const userId = payload.data.meta.userId;
      const tokens = payload.data.meta.tokens;

      const ref = admin.firestore().collection("userTokens").doc(userId);

      await ref.set(
        {
          userId,
          balance: admin.firestore.FieldValue.increment(tokens),
        },
        { merge: true }
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

export default router;