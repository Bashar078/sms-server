const express = require("express");
const twilio = require("twilio");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("SMS server is running");
});

app.post("/send-sms", async (req, res) => {
  const { to, message, accountSid, authToken, from } = req.body;

  if (!to || !message || !accountSid || !authToken || !from) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const client = twilio(accountSid, authToken);
    const result = await client.messages.create({
      body: message,
      from: from,
      to: to,
    });
    res.json({ success: true, sid: result.sid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
