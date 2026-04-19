const express = require("express");
const twilio = require("twilio");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors());

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

app.post("/make-call", async (req, res) => {
  const { to, accountSid, authToken, from, agencyName, callerName, serverUrl } = req.body;
  if (!to || !accountSid || !authToken || !from) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  try {
    const client = twilio(accountSid, authToken);
    const call = await client.calls.create({
      to: to,
      from: from,
      url: `${serverUrl}/ivr-menu?agencyName=${encodeURIComponent(agencyName)}&callerName=${encodeURIComponent(callerName)}`,
      statusCallback: `${serverUrl}/call-status`,
      statusCallbackMethod: "POST",
    });
    res.json({ success: true, callSid: call.sid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/ivr-menu", (req, res) => {
  const { agencyName, callerName } = req.query;
  const twiml = new twilio.twiml.VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: "/ivr-response",
    timeout: 10,
  });
  gather.say(
    { voice: "Polly.Amy", language: "en-AU" },
    `Hi, this is ${callerName} calling from ${agencyName}. ` +
    `We are reaching out to homeowners in your area with a market update. ` +
    `Press 1 if you are interested in a free property appraisal. ` +
    `Press 2 to receive recent sold prices in your suburb by SMS. ` +
    `Press 3 to be removed from our list. ` +
    `Press 4 to speak with one of our agents.`
  );
  twiml.redirect(
    "/ivr-menu?agencyName=" + encodeURIComponent(agencyName) +
    "&callerName=" + encodeURIComponent(callerName)
  );
  res.type("text/xml").send(twiml.toString());
});

app.post("/ivr-response", (req, res) => {
  const { Digits } = req.body;
  const twiml = new twilio.twiml.VoiceResponse();
  const responses = {
    "1": "Fantastic. One of our agents will be in touch shortly to arrange your free appraisal.",
    "2": "No problem. We will send you the latest sold prices in your suburb by SMS shortly.",
    "3": "Understood. We will remove you from our list immediately. Have a great day.",
    "4": "Please hold while we connect you to one of our agents.",
  };
  const msg = responses[Digits] || "Sorry, we did not receive your selection. Please try again.";
  twiml.say({ voice: "Polly.Amy", language: "en-AU" }, msg);
  twiml.hangup();
  res.type("text/xml").send(twiml.toString());
});

app.post("/call-status", (req, res) => {
  console.log("Call status:", req.body.CallStatus);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
