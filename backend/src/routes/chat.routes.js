import { Router } from "express";
import { chatWithAssistant } from "../controllers/chat.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";

const router = Router();

router.post("/", authenticate, chatWithAssistant);

export default router;
