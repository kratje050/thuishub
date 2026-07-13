import { Router } from 'express';
import { createUser, endSession, hasUsers, startSession, verifyUser } from '../auth.js';

export const authRouter = Router();

authRouter.get('/status', (req, res) => {
  res.json({ setupRequired: !hasUsers(), user: req.user || null });
});

authRouter.post('/setup', async (req, res) => {
  if (hasUsers()) return res.status(409).json({ error: 'De eerste installatie is al voltooid.' });
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || username.trim().length < 2) return res.status(400).json({ error: 'Kies een gebruikersnaam van minimaal 2 tekens.' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Kies een wachtwoord van minimaal 8 tekens.' });
  const user = await createUser(username, password, 'admin');
  startSession(res, user);
  res.status(201).json({ user });
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = typeof username === 'string' && typeof password === 'string' ? await verifyUser(username, password) : null;
  if (!user) return res.status(401).json({ error: 'Onjuiste gebruikersnaam of wachtwoord.' });
  startSession(res, user);
  res.json({ user });
});

authRouter.post('/logout', (req, res) => {
  endSession(req, res);
  res.status(204).end();
});
