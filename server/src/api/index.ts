import express from "express";
import router from "./routes/router";

const server = express();

server.use(express.json());
server.use(router);

server.listen(8000, () => console.log("Listening on localhost."));
