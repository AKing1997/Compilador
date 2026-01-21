// CONFIG
const STORAGE_KEY = 'uoc_compiler_progress_v2'; // Solo guardaremos progreso local, no preguntas

// STATE
let state = {
    allQuestions: [],        // Vienen de MongoDB
    activeQuestions: [],     // Preguntas del modo actual
    mode: 'normal',          // 'normal' | 'retry'
    currentIndex: 0,
    answers: {},             // { mongoId: userSelectedOptionIndex } 
    shuffledOptions: {}      // { mongoId: [ {txt, originalIdx} ] } 
};

// DOM ELEMENTS
const els = {
    setup: document.getElementById('setup-screen'),
    app: document.getElementById('app'),
    sidebar: document.getElementById('sidebar'),
    fileInput: document.getElementById('fileInput'),
    questionText: document.getElementById('questionText'),
    optionsContainer: document.getElementById('optionsContainer'),
    grid: document.getElementById('questionGrid'),
    progressBar: document.getElementById('progressBar'),
    currentQDisplay: document.getElementById('current-q-display'),
    stats: {
        correct: document.getElementById('stat-correct'),
        wrong: document.getElementById('stat-wrong'),
        pending: document.getElementById('stat-pending')
    },
    retryBtn: document.getElementById('retryBtn'),
    modeBadge: document.getElementById('mode-badge'),
    feedback: document.getElementById('feedbackMsg'),
    addModal: document.getElementById('add-modal')
};

// --- INIT (CONEXIÓN BACKEND) ---
function init() {
    // 1. Pedir preguntas a la Base de Datos
    fetch('/api/questions')
        .then(res => res.json())
        .then(data => {
            if (data && data.length > 0) {
                // Si hay preguntas en BD, iniciamos la app
                initializeGame(data);
            } else {
                // Si la BD está vacía, mostramos pantalla de carga
                els.setup.style.display = 'flex';
            }
        })
        .catch(err => {
            console.error("Error conectando a API:", err);
            alert("No se pudo conectar al servidor. Asegúrate de que Docker está corriendo.");
        });
}

function initializeGame(serverData) {
    // Añadimos un ID temporal si no lo tienen (aunque Mongo ya da _id)
    const processedData = serverData.map((q, i) => ({
        ...q,
        tempId: q._id || i
    }));

    // Recuperar progreso local del usuario (respuestas)
    const savedProgress = localStorage.getItem(STORAGE_KEY);
    let savedAnswers = {};
    let savedShuffles = {};

    if (savedProgress) {
        try {
            const parsed = JSON.parse(savedProgress);
            savedAnswers = parsed.answers || {};
            savedShuffles = parsed.shuffledOptions || {};
        } catch (e) { console.error("Error cargando progreso local"); }
    }

    // Barajar preguntas (siempre aleatorio al iniciar, o podrías guardar seed)
    const shuffledQuestions = processedData.sort(() => Math.random() - 0.5);

    state.allQuestions = shuffledQuestions;
    state.activeQuestions = shuffledQuestions;
    state.currentIndex = 0;
    state.answers = savedAnswers;
    state.shuffledOptions = savedShuffles; // Mantener orden visual de las que ya respondiste
    state.mode = 'normal';

    startApp();
}

// --- IMPORTACIÓN MASIVA (SUBIDA DE JSON) ---
els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const data = JSON.parse(evt.target.result);
            if (!Array.isArray(data)) throw new Error("Formato incorrecto: Debe ser un array.");

            // Enviar a MongoDB
            fetch('/api/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            })
                .then(res => res.json())
                .then(response => {
                    if (response.success) {
                        alert("Base de datos actualizada correctamente.");
                        location.reload(); // Recargar para obtener datos frescos
                    } else {
                        alert("Error guardando en BD: " + response.error);
                    }
                });

        } catch (err) {
            alert("El archivo no es un JSON válido.");
        }
    };
    reader.readAsText(file);
});

// --- LÓGICA DE UI ---
function startApp() {
    els.setup.style.display = 'none';
    els.app.style.display = 'flex';
    renderSidebar();
    loadQuestion();
    updateUI();
}

function loadQuestion() {
    // Evitar errores de índice
    if (state.activeQuestions.length === 0) return;
    if (state.currentIndex >= state.activeQuestions.length) state.currentIndex = 0;

    const q = state.activeQuestions[state.currentIndex];
    const qId = q.tempId; // Usamos ID de mongo o indice

    // Textos
    els.questionText.textContent = q.question;
    els.currentQDisplay.textContent = `Pregunta ${state.currentIndex + 1} / ${state.activeQuestions.length}`;

    // Preparar opciones
    let optionsMap;
    // Si ya existe un orden guardado para esta pregunta, usarlo (para que no cambien si vuelves atrás)
    if (state.shuffledOptions[qId]) {
        optionsMap = state.shuffledOptions[qId];
    } else {
        // Nuevo barajado de opciones
        optionsMap = q.options.map((txt, idx) => ({ txt, originalIdx: idx }));
        optionsMap.sort(() => Math.random() - 0.5);
        state.shuffledOptions[qId] = optionsMap;
    }

    // Renderizar
    els.optionsContainer.innerHTML = '';
    els.feedback.textContent = '';

    const userAnswer = state.answers[qId];
    const isAnswered = userAnswer !== undefined;

    optionsMap.forEach((opt, uiIdx) => {
        const btn = document.createElement('button');
        btn.className = 'opt-btn';
        btn.textContent = opt.txt;

        if (isAnswered) {
            btn.disabled = true;
            if (opt.originalIdx === q.correct) btn.classList.add('correct');
            else if (uiIdx === userAnswer) btn.classList.add('wrong');
        } else {
            btn.onclick = () => handleAnswer(qId, uiIdx, opt.originalIdx);
        }
        els.optionsContainer.appendChild(btn);
    });

    if (isAnswered) {
        const selectedOriginal = optionsMap[userAnswer].originalIdx;
        const correctTxt = (selectedOriginal === q.correct) ? "¡Correcto!" : "Incorrecto";
        els.feedback.textContent = correctTxt;
        els.feedback.style.color = (selectedOriginal === q.correct) ? "var(--success)" : "var(--error)";
    }

    document.querySelector('.question-wrapper').scrollTo(0, 0);

    // Sidebar active
    document.querySelectorAll('.q-dot').forEach(d => d.classList.remove('active'));
    const activeDot = document.getElementById(`dot-${state.currentIndex}`);
    if (activeDot) activeDot.classList.add('active');

    saveProgress();
}

function handleAnswer(qId, uiIdx, originalIdx) {
    state.answers[qId] = uiIdx;
    loadQuestion();
    updateUI();
    renderSidebar();
}

function navigate(dir) {
    const newIdx = state.currentIndex + dir;
    if (newIdx >= 0 && newIdx < state.activeQuestions.length) {
        state.currentIndex = newIdx;
        loadQuestion();
    }
}

function jumpTo(idx) {
    state.currentIndex = idx;
    loadQuestion();
    els.sidebar.classList.remove('open');
}

// --- SIDEBAR & STATS ---
function renderSidebar() {
    els.grid.innerHTML = '';
    state.activeQuestions.forEach((q, idx) => {
        const dot = document.createElement('div');
        dot.className = 'q-dot';
        dot.id = `dot-${idx}`;
        dot.textContent = idx + 1;

        const ans = state.answers[q.tempId];
        if (ans !== undefined) {
            const opts = state.shuffledOptions[q.tempId];
            if (opts && opts[ans]) {
                const originalChosen = opts[ans].originalIdx;
                if (originalChosen === q.correct) dot.classList.add('correct');
                else dot.classList.add('wrong');
            }
        }
        if (idx === state.currentIndex) dot.classList.add('active');
        dot.onclick = () => jumpTo(idx);
        els.grid.appendChild(dot);
    });
}

function updateUI() {
    let correct = 0, wrong = 0;
    state.activeQuestions.forEach(q => {
        const ans = state.answers[q.tempId];
        if (ans !== undefined) {
            const opts = state.shuffledOptions[q.tempId];
            if (opts && opts[ans].originalIdx === q.correct) correct++;
            else wrong++;
        }
    });

    els.stats.correct.textContent = correct;
    els.stats.wrong.textContent = wrong;
    els.stats.pending.textContent = state.activeQuestions.length - (correct + wrong);

    const pct = ((correct + wrong) / state.activeQuestions.length) * 100 || 0;
    els.progressBar.style.width = `${pct}%`;

    // Botón Retry
    if (state.mode === 'normal' && wrong > 0) {
        els.retryBtn.style.display = 'block';
    } else {
        els.retryBtn.style.display = 'none';
    }

    els.modeBadge.textContent = state.mode === 'normal' ? 'Modo Examen' : 'Repaso de Fallos';
    els.modeBadge.style.background = state.mode === 'normal' ? '#dbeafe' : '#fef3c7';
    els.modeBadge.style.color = state.mode === 'normal' ? '#1e40af' : '#92400e';
}

// --- MODOS Y RESET ---
function startRetryMode() {
    const failures = state.allQuestions.filter(q => {
        const ans = state.answers[q.tempId];
        if (ans === undefined) return false;
        const opts = state.shuffledOptions[q.tempId];
        return opts[ans].originalIdx !== q.correct;
    });

    if (failures.length === 0) return;

    if (confirm(`Se iniciará sesión con ${failures.length} fallos. ¿Seguro?`)) {
        state.activeQuestions = failures;
        state.currentIndex = 0;

        // Limpiamos respuestas de las falladas para reintentar
        failures.forEach(q => {
            delete state.answers[q.tempId];
        });

        state.mode = 'retry';
        saveProgress();
        startApp();
    }
}

function resetExam() {
    if (confirm("¿Borrar tu progreso local? (Las preguntas seguirán en la base de datos)")) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
    }
}

// --- GESTIÓN DE NUEVAS PREGUNTAS (MODAL) ---
function openAddModal() { els.addModal.style.display = 'flex'; }
function closeAddModal() { els.addModal.style.display = 'none'; }

function submitNewQuestion() {
    const qText = document.getElementById('new-q-text').value;
    const inputs = document.querySelectorAll('.opt-input');
    const correctIdx = document.getElementById('new-q-correct').value;

    const options = Array.from(inputs).map(i => i.value).filter(v => v.trim() !== "");

    if (!qText || options.length < 2) {
        return alert("Debes rellenar el enunciado y al menos 2 opciones.");
    }

    const payload = {
        question: qText,
        options: options,
        correct: parseInt(correctIdx)
    };

    fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert("Pregunta guardada en Base de Datos.");
                closeAddModal();
                location.reload();
            } else {
                alert("Error al guardar.");
            }
        });
}

// UTILS
function saveProgress() {
    // Guardamos solo respuestas y orden de opciones para persistencia local del usuario
    const toSave = {
        answers: state.answers,
        shuffledOptions: state.shuffledOptions
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

function toggleSidebar() { els.sidebar.classList.toggle('open'); }

// START
init();