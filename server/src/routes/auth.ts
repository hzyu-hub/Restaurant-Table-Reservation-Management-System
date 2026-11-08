/** POST /api/auth/login */
import { Router } from 'express';
import { loginStaff } from '../lib/auth.js';
import { asyncHandler } from '../lib/http.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const session = await loginStaff(req.body);
    res.status(200).json(session);
  }),
);
