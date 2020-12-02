import http from "http";
import bodyParser from "body-parser";
import express from "express";
import path from "path";
import session from "express-session";
import connect from "connect-mongodb-session";
import cookieParser from "cookie-parser";

import db from "./db";
import aux from "./appaux";
import config from "./models/config";
import discord from "./processes/shard-manager";
import { socket } from "./processes/socket";

import apiRoutes from "./routes/api";
import rssRoutes from "./routes/rss";

const app = express();

process.on('unhandledRejection', function(err) {
  console.log("unhandled rejection:");
  console.log(err);
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(cookieParser());

app.use(async (req, res, next) => {
  // res.set("Access-Control-Allow-Origin", process.env.HOST);
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.set("Access-Control-Allow-Headers", "authorization, accept, content-type, origin, x-requested-with, host, origin, referer, locale");
  next();
});

/**
 * EJS
 */
app.set("view engine", "ejs");
app.set("views", "views");

if (process.env.MAINTENANCE.toLowerCase() == "true") {
  const server = http.createServer(app).listen(process.env.PORT || 5000);
  aux.log("App started!");

  app.use("/", (req: any, res, next) => {
    res.render("maintenance");
  });
} else {
  app.locals.config = config;
  app.locals.host = process.env.HOST;
  app.locals.supportedLanguages = require("../lang/langs.json");
  app.locals.langs = app.locals.supportedLanguages.langs
    .map((lang: String) => {
      return {
        code: lang,
        ...require(`../lang/${lang}.json`),
      };
    })
    .sort((a: any, b: any) => (a.name > b.name ? 1 : -1));

  /**
   * Session
   */
  const MongoDBStore = connect(session);
  const store = new MongoDBStore({
    uri: process.env.MONGODB_URL,
    collection: "sessions", //,
    // expires: 12 * 60 * 60 * 1000 // 12 hours
  });
  app.use(
    session({
      secret: `${process.env.HOST}/${process.env.TOKEN}`,
      resave: false,
      saveUninitialized: false,
      store: store,
    })
  );

  let connected: boolean;
  let connecting = false;

  // Initialize the Discord event handlers and then call a
  // callback function when the bot has logged in.
  // Return the client to pass to the app routing logic.
  const client = discord.processes(
    {
      app: app,
    },
    async () => {
      // Create the database connection
      if (!connected && !connecting) {
        connecting = true;
        connected = await db.database.connect();
        if (connected) {
          aux.log("Database connected!");

          // Start the http server
          const server = http.createServer(app).listen(process.env.PORT || 5000);

          server.on("connection", () => {
            connecting = false;
          });

          const io = socket(server);

          aux.log("App started!");
        } else {
          aux.log("Database not connected!");
        }
      }
    }
  );

  /**
   * Routes
   */
  app.use(apiRoutes({ client: client }));
  app.use(rssRoutes());
  app.use("/", (req: any, res, next) => {
    res.send("");
  });
}
