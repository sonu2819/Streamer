// const express = require("express");
// const axios = require("axios");

// const app = express();

// const FILE_ID = "1U9bQQjLcI5QCPuJ66E5fqXI0WmDceuBN";

// app.get("/movie.mp4", async (req, res) => {
//   try {
//     const driveUrl = `https://drive.google.com/uc?export=download&id=${FILE_ID}`;

//     const response = await axios({
//       url: driveUrl,
//       method: "GET",
//       responseType: "stream",
//       maxRedirects: 5,
//       headers: req.headers.range
//         ? { Range: req.headers.range }
//         : {},
//       validateStatus: () => true,
//     });

//     res.status(response.status);

//     res.setHeader(
//       "Content-Type",
//       response.headers["content-type"] || "video/mp4"
//     );

//     if (response.headers["content-length"]) {
//       res.setHeader("Content-Length", response.headers["content-length"]);
//     }

//     if (response.headers["accept-ranges"]) {
//       res.setHeader("Accept-Ranges", response.headers["accept-ranges"]);
//     }

//     if (response.headers["content-range"]) {
//       res.setHeader("Content-Range", response.headers["content-range"]);
//     }

//     res.setHeader(
//       "Content-Disposition",
//       'inline; filename="movie.mp4"'
//     );

//     response.data.pipe(res);

//   } catch (err) {
//     console.error(err);
//     res.status(500).send(err.message);
//   }
// });

// const PORT = process.env.PORT || 3000;

// app.listen(PORT, () => {
//   console.log(`Server running at http://localhost:${PORT}/movie.mp4`);
// });

const express = require("express");
const { google } = require("googleapis");
const fs = require("fs").promises;
const path = require("path");
const cors = require('cors');

const app = express();
app.use(express.json());

// --- Global CORS (for simplicity) ---
app.use(cors());

// --- Explicit CORS for the video endpoint (for Waveparty) ---
app.options('/movie.mp4', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, RANGE');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Range, Content-Type, Accept, Origin, User-Agent');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
  res.sendStatus(204);
});

const MOVIE_FILE = path.join(__dirname, "movie.json");
const SERVICE_ACCOUNT_FILE = path.join(__dirname, "service-account-key.json");

let cachedFileId = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000;

async function getFileId() {
  const now = Date.now();
  if (cachedFileId && (now - cacheTimestamp) < CACHE_TTL) return cachedFileId;
  try {
    const data = await fs.readFile(MOVIE_FILE, "utf8");
    const { fileId } = JSON.parse(data);
    if (!fileId) throw new Error("fileId missing");
    cachedFileId = fileId;
    cacheTimestamp = now;
    return fileId;
  } catch (err) {
    throw new Error("Unable to read movie config: " + err.message);
  }
}

async function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_FILE,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

const API_KEY = process.env.API_KEY || "change_me";
app.post("/update-movie", async (req, res) => {
  const { fileId, apiKey } = req.body;
  if (apiKey !== API_KEY) {
    return res.status(403).json({ success: false, message: "Invalid API key" });
  }
  if (!fileId) {
    return res.status(400).json({ success: false, message: "fileId is required" });
  }
  try {
    await fs.writeFile(MOVIE_FILE, JSON.stringify({ fileId }, null, 2));
    cachedFileId = fileId;
    cacheTimestamp = Date.now();
    res.json({ success: true, message: "Movie updated", fileId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Stream Movie ---
app.get("/movie.mp4", async (req, res) => {
  try {
    const fileId = await getFileId();
    const drive = await getDriveClient();

    const requestOptions = { fileId: fileId, alt: "media" };
    if (req.headers.range) {
      requestOptions.headers = { Range: req.headers.range };
    }

    const response = await drive.files.get(requestOptions, { responseType: "stream" });
    const stream = response.data;

    // ----- SET EXPLICIT CORS HEADERS FOR WAVEPARTY -----
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
    // ----------------------------------------------------

    let statusCode = 200;
    if (response.response && response.response.headers) {
      const headers = response.response.headers;
      if (headers["content-range"]) statusCode = 206;
      if (headers["content-type"]) res.setHeader("Content-Type", headers["content-type"]);
      if (headers["content-length"]) res.setHeader("Content-Length", headers["content-length"]);
      if (headers["content-range"]) res.setHeader("Content-Range", headers["content-range"]);
      if (headers["accept-ranges"]) res.setHeader("Accept-Ranges", headers["accept-ranges"]);
    }
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", 'inline; filename="movie.mp4"');
    res.status(statusCode);

    stream.pipe(res);
    stream.on("error", (err) => {
      console.error("Stream error:", err);
      if (!res.headersSent) res.status(500).send("Error streaming file");
    });

  } catch (err) {
    console.error("Error:", err.message);
    if (!res.headersSent) {
      if (err.code === 404) res.status(404).send("Movie not found");
      else res.status(500).send("Internal server error");
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running: http://localhost:${PORT}/movie.mp4`);
});



