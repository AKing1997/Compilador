const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); // Límite alto para subir el JSON inicial
app.use(express.static('public'));

// --- CONFIGURACIÓN MONGODB ---
// 'mongo' es el nombre del servicio en docker-compose
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/examendb';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Conectado a MongoDB'))
    .catch(err => console.error('❌ Error de conexión a Mongo:', err));

// Definir el Modelo (Esquema) de la Pregunta
const QuestionSchema = new mongoose.Schema({
    question: { type: String, required: true },
    options: [{ type: String, required: true }],
    correct: { type: Number, required: true }
});

const Question = mongoose.model('Question', QuestionSchema);

// --- RUTAS API ---

// 1. Obtener todas las preguntas
app.get('/api/questions', async (req, res) => {
    try {
        const questions = await Question.find({});
        res.json(questions);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener preguntas' });
    }
});

// 2. Insertar UNA nueva pregunta (desde el modal)
app.post('/api/questions', async (req, res) => {
    try {
        const newQ = new Question(req.body);
        await newQ.save();
        res.json({ success: true, id: newQ._id });
    } catch (err) {
        res.status(400).json({ error: 'Datos inválidos' });
    }
});

// 3. Carga Masiva (Para subir tu JSON inicial)
// Esto permite que el frontend suba el archivo questions.json y lo guarde en Mongo
app.post('/api/import', async (req, res) => {
    try {
        const questionsArray = req.body;
        if (!Array.isArray(questionsArray)) {
            return res.status(400).json({ error: 'Se esperaba un array' });
        }

        // Borramos lo anterior (opcional) y metemos lo nuevo
        await Question.deleteMany({});
        await Question.insertMany(questionsArray);

        res.json({ success: true, count: questionsArray.length });
    } catch (err) {
        res.status(500).json({ error: 'Error en importación masiva' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
});