import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import matchesRoutes from './routes/matches.js';
import fantasyTeamsRoutes from './routes/fantasyTeams.js';
import adminRoutes from './routes/admin.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'Fantasy App API running' }));

app.use('/api/auth', authRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/fantasy-teams', fantasyTeamsRoutes);
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
