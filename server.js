require('dotenv').config(); // Si usas variables de entorno localmente
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_UOC_2024'; // ¡Cámbialo en producción!

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '20mb' }));
app.use(express.static('public'));

// --- MONGODB CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/examendb';
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Conectado'))
    .catch(err => console.error('❌ Error Mongo:', err));

// --- SCHEMAS & MODELS ---

// 1. Modelo de Pregunta (Global)
const QuestionSchema = new mongoose.Schema({
    question: { type: String, required: true, unique: true }, // Evitar duplicados exactos
    options: [{ type: String, required: true }],
    correct: { type: Number, required: true }
});
const Question = mongoose.model('Question', QuestionSchema);

// 2. Modelo de Progreso de Usuario
const ProgressSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true }, // 'ankit' o 'naiel'
    answers: { type: Map, of: Number, default: {} },        // { q_id: selected_opt_idx }
    shuffledOptions: { type: Map, of: Array, default: {} }, // { q_id: [mapped_opts] }
    currentIndex: { type: Number, default: 0 },
    mode: { type: String, default: 'normal' }
});
const Progress = mongoose.model('Progress', ProgressSchema);


// --- MIDDLEWARE DE AUTH ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) return res.sendStatus(401); // Unauthorized

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // Forbidden
        req.user = user; // { username: 'ankit' }
        next();
    });
}


// --- RUTAS API ---

// LOGIN (Hardcoded para ankit/naiel como pediste)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // En un sistema real, esto verificaría hash en DB
    const validUsers = {
        'ankit': 'password123', // ¡Contraseñas de ejemplo!
        'naiel': 'uoc2024'
    };

    if (validUsers[username] && validUsers[username] === password) {
        // Generar Token
        const token = jwt.sign({ username: username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, username });
    } else {
        res.status(401).json({ error: 'Credenciales incorrectas' });
    }
});

// GET PREGUNTAS (Público o Privado, lo dejamos público para cargar rápido)
app.get('/api/questions', async (req, res) => {
    const questions = await Question.find({});
    res.json(questions);
});

// GET PROGRESO USUARIO (Privado)
app.get('/api/progress', authenticateToken, async (req, res) => {
    try {
        let progress = await Progress.findOne({ userId: req.user.username });
        if (!progress) {
            // Si es la primera vez, crear progreso vacío
            progress = new Progress({ userId: req.user.username });
            await progress.save();
        }
        res.json(progress);
    } catch (err) {
        res.status(500).json({ error: 'Error al cargar progreso' });
    }
});

// SAVE PROGRESO USUARIO (Privado)
app.post('/api/progress', authenticateToken, async (req, res) => {
    try {
        const { answers, shuffledOptions, currentIndex, mode } = req.body;
        await Progress.findOneAndUpdate(
            { userId: req.user.username },
            { answers, shuffledOptions, currentIndex, mode },
            { upsert: true }
        );
        res.sendStatus(200);
    } catch (err) {
        res.sendStatus(500);
    }
});

// RESET PROGRESO (Privado)
app.delete('/api/progress', authenticateToken, async (req, res) => {
    await Progress.deleteOne({ userId: req.user.username });
    res.sendStatus(200);
});


// --- RUTAS DE GESTIÓN DE CONTENIDO (ADMIN/DOCENTE) ---

// IMPORTAR/MERGE MASIVO (Privado - Podrías restringirlo más)
app.post('/api/import', authenticateToken, async (req, res) => {
    const questionsArray = req.body;
    if (!Array.isArray(questionsArray)) return res.status(400).json({ error: 'Array requerido' });

    let added = 0;
    let duplicates = 0;

    // Usamos un bucle para manejar errores de duplicados (unique: true en schema)
    for (const q of questionsArray) {
        try {
            const newQ = new Question(q);
            await newQ.save();
            added++;
        } catch (e) {
            if (e.code === 11000) duplicates++; // Error de clave duplicada de Mongo
            else console.error("Error importando pregunta:", e);
        }
    }

    res.json({ success: true, added, duplicates, total_in_db: await Question.countDocuments() });
});

// CREAR UNA PREGUNTA (Privado)
app.post('/api/question', authenticateToken, async (req, res) => {
    try {
        const newQ = new Question(req.body);
        await newQ.save();
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});


app.listen(PORT, () => {
    console.log(`🚀 Servidor SaaS UOC en http://localhost:${PORT}`);
});