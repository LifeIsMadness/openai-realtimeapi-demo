import express from "express";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent"

const httpAgent = new HttpsProxyAgent(process.env.http_proxy)
const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY;
const axios_with_proxy = axios.create({httpAgent, proxy: false, httpsAgent: httpAgent});


// Configure Vite middleware for React client
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
});
app.use(vite.middlewares);

// API route for token generation
app.get("/token", async (req, res) => {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/realtime/sessions",
      {
          model: "gpt-4o-mini-realtime-preview",
          voice: "verse",
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    const data = await response.json();
    console.info(data);
    res.json(data);
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});


// API route to get sdp answer
app.post("/sdp", express.raw({
    inflate: true,
    limit: '50mb',
    type: () => true, // this matches all content types
}), async (req, res) => {
  //console.info(req.body.toString());
  try {
    // const r = await axios_with_proxy.get('https://dogapi.dog/api/v2/breeds');
    const token_response = await axios_with_proxy(
      {
        url: "https://api.openai.com/v1/realtime/sessions",
        method: "post",
        data: {
          model: "gpt-4o-mini-realtime-preview",
          voice: "verse",
        },
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    const token_data = await token_response.data;
    const EPHEMERAL_KEY = token_data.client_secret.value;
    console.info("Token", EPHEMERAL_KEY? "successfully obtained": "error");
    const response = await axios_with_proxy(
      {
        url: "https://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview",
        method: "post",
        data: req.body.toString(),
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
        },
      },
    );

    const sdp_data = await response.data;
    console.info(sdp_data? "Sdp answer obtained": "Error getting sdp answer.");
    res.send(sdp_data);
  } catch (error) {
    if (error.response) {
      console.error("Error:", error.response.status);
      console.error("Error:", error.response.data.error || error.response.data);
      console.error("Error:", error.response.headers);

    }
    else { console.error(error); }
    res.status(500).json({ "error": "Failed to get sdp" });
  }
});


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
