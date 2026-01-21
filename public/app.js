// --- CONFIG & STATE ---
let TOKEN = localStorage.getItem('auth_token'); // Solo guardamos el token localmente
let CURRENT_USER = localStorage.getItem('auth_user');

let state = {
    allQuestions: [],        // Preguntas globales (MongoDB)
    activeQuestions: [],     // Filtradas por modo
    mode: 'normal',
    currentIndex: 0,
    answers: {},             // { q_id: ui_index }
    shuffledOptions: {}      // { q_id: [opts] }
};

// DOM ELEMENTS (Selectores actualizados)
const els = {
    loginModal: document.getElementById('login-modal'),
    loginForm: document.getElementById('login-form'),
    loginError: document.getElementById('login-error'),
    userDisplay: document.getElementById('user-display'),
    setup: document.getElementById('setup-screen'),
    app: document.getElementById('app'),
    sidebar: document.getElementById('sidebar'),
    // Inputs de archivo
    fileInputInit: document.getElementById('fileInputInit'),
    fileInputMerge: document.getElementById('fileInputMerge'),
    // UI principal
    questionText: document.getElementById('questionText'),
    optionsContainer: document.getElementById('optionsContainer'),
    grid: document.getElementById('questionGrid'),
    progressBar: document.getElementById('progressBar'),
    currentQDisplay: document.getElementById('current-q-display'),
    stats: { correct: document.getElementById('stat-correct'), wrong: document.getElementById('stat-wrong'), pending: document.getElementById('stat-pending') },
    retryBtn: document.getElementById('retryBtn'),
    modeBadge: document.getElementById('mode-badge'),
    feedback: document.getElementById('feedbackMsg'),
    addModal: document.getElementById('add-modal')
};

// --- AUTHENTICATION START ---
function checkAuth() {
    if (TOKEN && CURRENT_USER) {
        els.loginModal.style.display = 'none';
        els.userDisplay.textContent = CURRENT_USER;
        initApp(); // Usuario logueado, iniciar app
    } else {
        els.loginModal.style.display = 'flex'; // Mostrar login
    }
}

els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    els.loginError.textContent = '';

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (res.ok) {
            TOKEN = data.token;
            CURRENT_USER = data.username;
            localStorage.setItem('auth_token', TOKEN);
            localStorage.setItem('auth_user', CURRENT_USER);
            checkAuth();
        } else {
            els.loginError.textContent = data.error || 'Error de login';
        }
    } catch (err) {
        els.loginError.textContent = 'Error de conexión con el servidor';
    }
});

function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    location.reload();
}

// Helper para llamadas autenticadas
async function authFetch(url, options = {}) {
    if (!options.headers) options.headers = {};
    options.headers['Authorization'] = `Bearer ${TOKEN}`;
    const res = await fetch(url, options);
    if (res.status === 401 || res.status === 403) logout(); // Token expirado/inválido
    return res;
}
// --- AUTH END ---


// --- APP INITIALIZATION (Server Sync) ---
async function initApp() {
    try {
        // 1. Cargar TODAS las preguntas
        const qRes = await authFetch('/api/questions');
        const questionsData = await qRes.json();

        if (!questionsData || questionsData.length === 0) {
            els.setup.style.display = 'flex'; // BD Vacía
            return;
        }
        els.setup.style.display = 'none';

        // 2. Cargar PROGRESO del usuario
        const pRes = await authFetch('/api/progress');
        const progressData = await pRes.json();

        // Mapear datos del servidor al estado local
        state.allQuestions = questionsData.map(q => ({ ...q, id: q._id })); // Usar _id de mongo

        // Restaurar estado del usuario
        state.answers = progressData.answers || {};
        state.shuffledOptions = progressData.shuffledOptions || {};
        state.mode = progressData.mode || 'normal';

        // Determinar preguntas activas según el modo
        if (state.mode === 'retry') {
            state.activeQuestions = state.allQuestions.filter(q => {
                const ansIdx = state.answers[q.id];
                if (ansIdx === undefined || !state.shuffledOptions[q.id]) return false;
                const originalIdx = state.shuffledOptions[q.id][ansIdx].originalIdx;
                return originalIdx !== q.correct;
            });
        } else {
            state.activeQuestions = [...state.allQuestions];
            // Si es modo normal, barajamos las preguntas si es la primera vez
            if (Object.keys(state.answers).length === 0) {
                state.activeQuestions.sort(() => Math.random() - 0.5);
            }
        }

        state.currentIndex = progressData.currentIndex || 0;

        // Arrancar UI
        els.app.style.display = 'flex';
        renderSidebar();
        loadQuestion();
        updateUI();

    } catch (err) {
        console.error("Error inicializando:", err);
        alert("Error sincronizando con el servidor.");
    }
}


// --- FILE UPLOADS (INIT & MERGE) ---

// Función genérica de importación
async function handleFileUpload(file, isInit = false) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
        try {
            const data = JSON.parse(evt.target.result);
            if (!Array.isArray(data)) throw new Error("Debe ser un array JSON");

            const res = await authFetch('/api/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();

            if (result.success) {
                alert(`Importación completada.\nAñadidas: ${result.added}\nDuplicadas (ignoradas): ${result.duplicates}\nTotal en BD: ${result.total_in_db}`);
                location.reload(); // Recargar para aplicar cambios
            } else {
                alert("Error en la importación.");
            }
        } catch (err) {
            alert("Error: Archivo JSON inválido.");
        }
    };
    reader.readAsText(file);
}

// Listeners de inputs
els.fileInputInit.addEventListener('change', e => handleFileUpload(e.target.files[0], true));
els.fileInputMerge.addEventListener('change', e => handleFileUpload(e.target.files[0], false));


// --- CORE UI LOGIC (Similar a la versión anterior pero con IDs de Mongo) ---

function loadQuestion() {
    if (state.activeQuestions.length === 0) {
        els.questionText.textContent = "No hay preguntas en este modo.";
        els.optionsContainer.innerHTML = "";
        return;
    }
    if (state.currentIndex >= state.activeQuestions.length) state.currentIndex = 0;

    const q = state.activeQuestions[state.currentIndex];
    const qId = q.id;

    els.questionText.textContent = q.question;
    els.currentQDisplay.textContent = `Pregunta ${state.currentIndex + 1} / ${state.activeQuestions.length}`;

    let optionsMap;
    if (state.shuffledOptions[qId]) {
        optionsMap = state.shuffledOptions[qId];
    } else {
        optionsMap = q.options.map((txt, idx) => ({ txt, originalIdx: idx }));
        optionsMap.sort(() => Math.random() - 0.5);
        state.shuffledOptions[qId] = optionsMap;
    }

    els.optionsContainer.innerHTML = '';
    els.feedback.textContent = '';

    const userAnswerIdx = state.answers[qId];
    const isAnswered = userAnswerIdx !== undefined && optionsMap[userAnswerIdx];

    optionsMap.forEach((opt, uiIdx) => {
        const btn = document.createElement('button');
        btn.className = 'opt-btn';
        btn.textContent = opt.txt;

        if (isAnswered) {
            btn.disabled = true;
            if (opt.originalIdx === q.correct) btn.classList.add('correct');
            else if (uiIdx === userAnswerIdx) btn.classList.add('wrong');
        } else {
            btn.onclick = () => handleAnswer(qId, uiIdx);
        }
        els.optionsContainer.appendChild(btn);
    });

    if (isAnswered) {
        const selectedOriginal = optionsMap[userAnswerIdx].originalIdx;
        els.feedback.textContent = (selectedOriginal === q.correct) ? "¡Correcto!" : "Incorrecto";
        els.feedback.style.color = (selectedOriginal === q.correct) ? "var(--success)" : "var(--error)";
    }

    document.querySelector('.question-wrapper').scrollTo(0, 0);
    document.querySelectorAll('.q-dot').forEach(d => d.classList.remove('active'));
    const activeDot = document.getElementById(`dot-${state.currentIndex}`);
    if (activeDot) activeDot.classList.add('active');
}

async function handleAnswer(qId, uiIdx) {
    state.answers[qId] = uiIdx;
    loadQuestion();
    updateUI();
    renderSidebar();
    // Guardar progreso en el servidor en tiempo real
    await saveProgressToServer();
}

async function saveProgressToServer() {
    // Convertir mapas a objetos planos para enviar
    await authFetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            answers: state.answers,
            shuffledOptions: state.shuffledOptions,
            currentIndex: state.currentIndex,
            mode: state.mode
        })
    });
}

function navigate(dir) {
    const newIdx = state.currentIndex + dir;
    if (newIdx >= 0 && newIdx < state.activeQuestions.length) {
        state.currentIndex = newIdx;
        loadQuestion();
        saveProgressToServer(); // Guardar posición
    }
}

function jumpTo(idx) {
    state.currentIndex = idx;
    loadQuestion();
    saveProgressToServer(); // Guardar posición
    els.sidebar.classList.remove('open');
}

// --- SIDEBAR, STATS, MODES (Lógica de UI) ---
// (Esta parte es visualmente idéntica a la versión anterior, pero usa los datos del estado sincronizado)

function renderSidebar() {
    els.grid.innerHTML = '';
    state.activeQuestions.forEach((q, idx) => {
        const dot = document.createElement('div');
        dot.className = 'q-dot';
        dot.id = `dot-${idx}`;
        dot.textContent = idx + 1;
        const ansIdx = state.answers[q.id];
        if (ansIdx !== undefined && state.shuffledOptions[q.id]) {
            const originalChosen = state.shuffledOptions[q.id][ansIdx].originalIdx;
            dot.classList.add(originalChosen === q.correct ? 'correct' : 'wrong');
        }
        if (idx === state.currentIndex) dot.classList.add('active');
        dot.onclick = () => jumpTo(idx);
        els.grid.appendChild(dot);
    });
}

function updateUI() {
    let correct = 0, wrong = 0;
    state.activeQuestions.forEach(q => {
        const ansIdx = state.answers[q.id];
        if (ansIdx !== undefined && state.shuffledOptions[q.id]) {
            const originalChosen = state.shuffledOptions[q.id][ansIdx].originalIdx;
            originalChosen === q.correct ? correct++ : wrong++;
        }
    });
    els.stats.correct.textContent = correct;
    els.stats.wrong.textContent = wrong;
    els.stats.pending.textContent = state.activeQuestions.length - (correct + wrong);
    const pct = ((correct + wrong) / state.activeQuestions.length) * 100 || 0;
    els.progressBar.style.width = `${pct}%`;
    els.retryBtn.style.display = (state.mode === 'normal' && wrong > 0) ? 'block' : 'none';
    els.modeBadge.textContent = state.mode === 'normal' ? 'Modo Examen' : 'Repaso de Fallos';
    els.modeBadge.style.background = state.mode === 'normal' ? '#dbeafe' : '#fef3c7';
    els.modeBadge.style.color = state.mode === 'normal' ? '#1e40af' : '#92400e';
}

// --- ACTIONS ---

async function startRetryMode() {
    if (confirm("Se activará el modo de repaso de fallos. ¿Continuar?")) {
        state.mode = 'retry';
        state.currentIndex = 0;
        await saveProgressToServer();
        initApp(); // Reinicializar para aplicar filtros
    }
}

async function resetExam() {
    if (confirm("¿Borrar TU progreso en el servidor y empezar de cero? (Las preguntas no se borran)")) {
        await authFetch('/api/progress', { method: 'DELETE' });
        location.reload();
    }
}

// --- MODAL CREAR PREGUNTA ---
function openAddModal() { els.addModal.style.display = 'flex'; }
function closeAddModal() { els.addModal.style.display = 'none'; }

async function submitNewQuestion() {
    const qText = document.getElementById('new-q-text').value;
    const inputs = document.querySelectorAll('.opt-input');
    const correctIdx = document.getElementById('new-q-correct').value;
    const options = Array.from(inputs).map(i => i.value).filter(v => v.trim() !== "");

    if (!qText || options.length < 3) return alert("Rellena el enunciado y 3 opciones.");

    const res = await authFetch('/api/question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: qText, options, correct: parseInt(correctIdx) })
    });
    const data = await res.json();
    if (data.success) {
        alert("Pregunta guardada.");
        closeAddModal();
        location.reload();
    } else {
        alert("Error: " + data.error);
    }
}

function toggleSidebar() { els.sidebar.classList.toggle('open'); }

// --- START ---
checkAuth(); // Al cargar, comprobar si hay token