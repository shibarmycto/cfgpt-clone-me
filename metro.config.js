const { getDefaultConfig } = require("expo/metro-config");
const http = require("http");

const config = getDefaultConfig(__dirname);

config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware) => {
    return (req, res, next) => {
      if (req.url && (req.url.startsWith("/api/") || req.url.startsWith("/preview/"))) {
        const options = {
          hostname: "localhost",
          port: 5000,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: "localhost:5000" },
        };

        const proxyReq = http.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
        });

        proxyReq.on("error", (err) => {
          console.error("[Metro Proxy] Error:", err.message);
          res.writeHead(502);
          res.end(JSON.stringify({ error: "Backend unavailable" }));
        });

        req.pipe(proxyReq, { end: true });
      } else {
        metroMiddleware(req, res, next);
      }
    };
  },
};

module.exports = config;
