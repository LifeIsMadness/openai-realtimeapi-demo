import express from "express";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { google } from "googleapis";

const httpAgent = new HttpsProxyAgent(process.env.http_proxy);
const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY;
const axios_with_proxy = axios.create({
  httpAgent,
  proxy: false,
  httpsAgent: httpAgent,
});
const prompt = fs.readFileSync("./promt.txt", "utf8");

// Configure Vite middleware for React client
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
});
app.use(vite.middlewares);

// token generation
async function getToken() {
  const token_response = await axios_with_proxy({
    url: "https://api.openai.com/v1/realtime/sessions",
    method: "post",
    data: {
      model: "gpt-4o-mini-realtime-preview",
      voice: "shimmer",
      instructions: prompt,
      input_audio_transcription: {
        model: "gpt-4o-transcribe",
        prompt:
          "Ожидай слова связанные с салоном красоты, его услугами и записью клиентов и номером телефона",
      },
      temperature: 0.65,
    },
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  return token_response.data;
}

// Create entry in a spreadsheet
app.post("/entry", async (req, res) => {
  const { name, phone, date, massage } = req.body;
  const SHEET_ID = process.env.SHEET_ID;
  const auth = new google.auth.GoogleAuth({
    keyFile: "google_auth.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  auth.getClient().then((client) => {
    const sheet = google.sheets({ version: "v4", auth: client });

    const rq = {
      spreadsheetId: SHEET_ID,
      range: "Лист1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values: [[name, phone, date, massage]],
      },
    };
    console.debug(rq);

    sheet.spreadsheets.values
      .append(rq)
      .then((res) => {
        console.log("Data added to the spreadsheet");
      })
      .catch((err) => {
        console.error(
          "Google sheets error:",
          err.response?.data || err.message || err,
        );
      });
  });
});

// API route to get sdp answer
app.post(
  "/sdp",
  express.raw({
    inflate: true,
    limit: "50mb",
    type: () => true, // this matches all content types
  }),
  async (req, res) => {
    try {
      // const r = await axios_with_proxy.get('https://dogapi.dog/api/v2/breeds');

      const token_data = await getToken();
      const EPHEMERAL_KEY = token_data.client_secret.value;
      console.info("Token", EPHEMERAL_KEY ? "successfully obtained" : "error");
      const response = await axios_with_proxy({
        url: "https://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview",
        method: "post",
        data: req.body.toString(),
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
        },
      });

      const sdp_data = response.data;
      console.info(
        sdp_data ? "Sdp answer obtained" : "Error getting sdp answer",
      );
      res.send(sdp_data);
    } catch (error) {
      if (error.response) {
        console.error("Error:", error.response.status);
        console.error(
          "Error:",
          error.response.data.error || error.response.data,
        );
        console.error("Error:", error.response.headers);
      } else {
        console.error(error);
      }
      res.status(500).json({ error: "Failed to get sdp" });
    }
  },
);

// Render the React client
app.use("*", async (req, res, next) => {
  const url = req.originalUrl;

  try {
    const template = await vite.transformIndexHtml(
      url,
      fs.readFileSync("./client/index.html", "utf-8"),
    );
    const { render } = await vite.ssrLoadModule("./client/entry-server.jsx");
    const appHtml = await render(url);
    const html = template.replace(`<!--ssr-outlet-->`, appHtml?.html);
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  } catch (e) {
    vite.ssrFixStacktrace(e);
    next(e);
  }
});

app.listen(port, () => {
  console.log(`Express server running on *:${port}`);
});
