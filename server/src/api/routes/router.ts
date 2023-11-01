import { Router } from "express";
import sellerRouter from "./sellers";

const router = Router();
router.use("/api", sellerRouter);

export default router;
